import {Inject, Injectable, InjectionToken} from '@angular/core';
import {HttpClient, HttpHeaders, HttpParams} from '@angular/common/http';
import {catchError, mergeMap, switchMap, tap} from 'rxjs/operators';
import {from, Observable, of, throwError} from 'rxjs';
import {unflatter} from '@monabbous/unflatter';

export const API_CONFIG = new InjectionToken<string>('APIConfig');

interface ServerVersions {
  [key: string]: string;
}

interface Server {
  baseUrl: string;
  versions: ServerVersions;
  defaultVersion: keyof ServerVersions;
}

interface Servers {
  [key: string]: Server;
}

export interface APIConfig {
  servers: Servers;
  defaultServer: keyof Servers;
  onSuccess?: (response: any, parameters: Request) => Observable<any>;
  onError?: (response: any, parameters: Request) => Observable<any>;
  methodOverride?: boolean;
}

interface Request {
  baseUrl?: string;
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  outsource?: boolean;
  server?: number | string;
  version?: number | string;
  prefix?: string;
  body?: {
    [key: string]: any;
  };
  token?: string;
  options?: {
    headers?: HttpHeaders | {
      [header: string]: string | string[];
    };
    observe?: 'body';
    params?: HttpParams | {
      [param: string]: string | string[];
    };
    reportProgress?: boolean;
    responseType?: 'json';
    withCredentials?: boolean;
  };
}

// @dynamic
@Injectable({
  providedIn: 'root'
})
export class NgApiWrapperService {

  static get prefix() {
    return localStorage.getItem('prefix');
  }

  static set prefix(prefix) {
    localStorage.setItem('prefix', prefix);
  }

  static get token() {
    return localStorage.getItem('token');
  }

  static set token(token) {
    localStorage.setItem('token', token);
  }

  static injectToken(headers, token = NgApiWrapperService.token) {
    if (token) {
      return (headers instanceof HttpHeaders ? headers :
        new HttpHeaders(typeof headers === 'object' ? headers : {}))
        .append('Authorization', 'Bearer ' + token);
    }
    return (headers instanceof HttpHeaders ? headers :
      new HttpHeaders(typeof headers === 'object' ? headers : {}));
  }

  static async jsonToFormData(object) {
    if (object instanceof FormData) {
      return object;
    }
    const formData = new FormData();
    let worthConverting = false;
    const append = async (data, keys = []) => {
      return await new Promise(async (res) => {
        for (const key of Object.keys(data)) {
          if (key === 'isFormArray') {
            delete data[key];
            continue;
          }
          const item = data[key];
          const itemKey = [...keys, key].map((k, i) => i > 0 ? `[${k}]` : k).join('');
          if (item instanceof Blob) {
            formData.append(itemKey, item);
            worthConverting = true;
          } else if ((Array.isArray(item) || (typeof item === 'object')) && item !== null && item !== undefined) {
            await append(item, [...keys, key]);
          } else {
            formData.append(itemKey, item);
          }
        }
        res();
      });
    };
    await append(object);
    return worthConverting ? formData : object;
  }

  constructor(
    private http: HttpClient,
    @Inject(API_CONFIG) public apiConfig: APIConfig,
  ) {
    console.log(apiConfig);
  }

  getFullUrl(server, version) {
    return this.apiConfig.servers[server]?.baseUrl + this.apiConfig.servers[server]?.versions[version];
  }

  handleServer(server) {
    if (!Object.keys(this.apiConfig.servers).includes(server)) {
      console.warn(`Ng Api Wrapper: Server '${server}' is not in the configuration, will use the defaultServer`);
      server = this.apiConfig.defaultServer;
    }
    return server;
  }

  handleServerVersion(server, version) {
    if (!Object.keys(this.apiConfig.servers[server].versions).includes(version)) {
      console.warn(`Ng Api Wrapper: Server '${server}' Api version '${version}' is not in the configuration, will use the defaultVersion`);
      version = this.apiConfig.servers[server]?.defaultVersion;
    }
    return version;
  }

  protected handleResponse<T>(request: Observable<T>, parameters: Request) {
    return request
      .pipe(
        switchMap(response => this.apiConfig.onSuccess ? this.apiConfig.onSuccess(response, parameters) : of(response)),
        catchError(response => this.apiConfig.onError ? this.apiConfig.onError(response, parameters) : throwError(response)),
      );
  }

  public get<T>({
                  path,
                  outsource,
                  body = {},
                  version,
                  server,
                  token,
                  prefix = (NgApiWrapperService.prefix || '') ? (NgApiWrapperService.prefix || '') + '/' : '',
                  options = {},
                }: Request) {
    server = this.handleServer(server);
    version = this.handleServerVersion(server, version);
    body = unflatter(body);

    // @ts-ignore
    let method = <S>(...a) => this.http.get<S>(...a);
    let args: any = [(outsource ? '' : this.getFullUrl(server, version)) + prefix + path, options];
    if (this.apiConfig?.methodOverride) {
      // @ts-ignore
      method = <S>(...a) => this.http.post<S>(...a);
      args = [(outsource ? '' : this.getFullUrl(server, version)) + prefix + path, {_method: 'GET', ...body}, options];
    }

    options.headers = NgApiWrapperService.injectToken(options.headers, token);
    const params = {...body};
    delete params._method;
    options.params = body ? new HttpParams({fromObject: params}) : options.params;
    return from(NgApiWrapperService.jsonToFormData(body))
      .pipe(
        mergeMap(b => {
          body = b;
          return this.handleResponse<T>(method<T>(...args), {
            baseUrl: this.getFullUrl(server, version),
            path,
            outsource,
            body,
            server,
            version,
            prefix,
            options,
            method: 'GET'
          });
        })
      );
  }

  public post<T>({
                   path,
                   outsource,
                   body = {},
                   version,
                   server,
                   token,
                   prefix = (NgApiWrapperService.prefix || '') ? (NgApiWrapperService.prefix || '') + '/' : '',
                   options = {},
                 }: Request) {
    server = this.handleServer(server);
    version = this.handleServerVersion(server, version);
    body = unflatter(body);
    options.headers = NgApiWrapperService.injectToken(options.headers, token);
    return from(NgApiWrapperService.jsonToFormData(body))
      .pipe(
        mergeMap(b => {
          body = b;
          return this.handleResponse<T>(this.http.post<T>(
            (outsource ? '' : this.getFullUrl(server, version)) + prefix + path, body, options), {
            baseUrl: this.getFullUrl(server, version),
            path,
            outsource,
            body,
            server,
            version,
            prefix,
            options,
            method: 'POST'
          });
        })
      );
  }

  public patch<T>({
                    path,
                    outsource,
                    body = {},
                    version,
                    server,
                    token,
                    prefix = (NgApiWrapperService.prefix || '') ? (NgApiWrapperService.prefix || '') + '/' : '',
                    options = {},
                  }: Request) {
    server = this.handleServer(server);
    version = this.handleServerVersion(server, version);
    body = unflatter(body);
    // @ts-ignore
    let method = <S>(...a) => this.http.patch<S>(...a);
    let args: any = [(outsource ? '' : this.getFullUrl(server, version)) + prefix + path, body, options];
    if (this.apiConfig?.methodOverride) {
      // @ts-ignore
      method = <S>(...a) => this.http.get<S>(...a);
      args = [(outsource ? '' : this.getFullUrl(server, version)) + prefix + path, {_method: 'PATCH', ...body}, options];
    }

    options.headers = NgApiWrapperService.injectToken(options.headers, token);
    return from(NgApiWrapperService.jsonToFormData(body))
      .pipe(
        mergeMap(b => {
          body = b;
          // @ts-ignore
          return this.handleResponse<T>(method<T>(...args), {
            baseUrl: this.getFullUrl(server, version),
            path,
            outsource,
            body,
            server,
            version,
            prefix,
            options,
            method: 'PATCH'
          });
        })
      );
  }

  public put<T>({
                  path,
                  outsource,
                  body,
                  version,
                  server,
                  token,
                  prefix = (NgApiWrapperService.prefix || '') ? (NgApiWrapperService.prefix || '') + '/' : '',
                  options = {},
                }: Request) {
    server = this.handleServer(server);
    version = this.handleServerVersion(server, version);
    body = unflatter(body);
    // @ts-ignore
    let method = <S>(...a) => this.http.put<S>(...a);
    let args: any = [(outsource ? '' : this.getFullUrl(server, version)) + prefix + path, body, options];
    if (this.apiConfig?.methodOverride) {
      // @ts-ignore
      method = <S>(...a) => this.http.get<S>(...a);
      args = [(outsource ? '' : this.getFullUrl(server, version)) + prefix + path, {_method: 'PUT', ...body}, options];
    }

    options.headers = NgApiWrapperService.injectToken(options.headers, token);
    return from(NgApiWrapperService.jsonToFormData(body))
      .pipe(
        mergeMap(b => {
          body = b;
          // @ts-ignore
          return this.handleResponse<T>(method<T>(...args), {
            baseUrl: this.getFullUrl(server, version),
            path,
            outsource,
            body,
            server,
            version,
            prefix,
            options,
            method: 'PUT'
          });
        })
      );
  }

  public delete<T>({
                     path,
                     outsource,
                     body = {},
                     version,
                     server,
                     token,
                     prefix = (NgApiWrapperService.prefix || '') ? (NgApiWrapperService.prefix || '') + '/' : '',
                     options = {},
                   }: Request) {
    server = this.handleServer(server);
    version = this.handleServerVersion(server, version);
    body = unflatter(body);
    // @ts-ignore
    let method = <S>(...a) => this.http.delete<S>(...a);
    let args: any = [(outsource ? '' : this.getFullUrl(server, version)) + prefix + path, body, options];
    if (this.apiConfig?.methodOverride) {
      // @ts-ignore
      method = <S>(...a) => this.http.get<S>(...a);
      args = [(outsource ? '' : this.getFullUrl(server, version)) + prefix + path, {_method: 'DELETE', ...body}, options];
    }

    options.headers = NgApiWrapperService.injectToken(options.headers, token);
    return from(NgApiWrapperService.jsonToFormData(body))
      .pipe(
        mergeMap(b => {
          body = b;
          // @ts-ignore
          return this.handleResponse<T>(method<T>(...args), {
            baseUrl: this.getFullUrl(server, version),
            path,
            outsource,
            body,
            server,
            version,
            prefix,
            options,
            method: 'DELETE'
          });
        })
      );
  }
}
