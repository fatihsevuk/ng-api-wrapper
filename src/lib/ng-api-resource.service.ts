import {Injectable} from '@angular/core';
import {distinctUntilChanged, filter, map, switchMap, tap} from 'rxjs/operators';
import {isEqual} from 'lodash';
import {BehaviorSubject, Observable, of} from 'rxjs';
import {ActivatedRoute} from '@angular/router';
import {NgApiWrapperService} from './ng-api-wrapper.service';
import {digger} from '@monabbous/object-digger';

export interface ResourceModel {
  id: number;
}

export interface ResourcePagination {
  per_page: number;
  current_page: number;
  total: number;
}

export interface ResourcePage<T> {
  data: T[];
  meta: {
    pagination: ResourcePagination,
  };
}

export interface ResourceItem<T> {
  data: T;
  meta: any;
}

export function smartResourcePageRefresh<T extends ResourceModel>(unique = 'id') {
  return distinctUntilChanged((pre: ResourcePage<T>, cur: ResourcePage<T>) => {
    const preData = pre.data;
    const curData = cur.data;
    if (curData.length !== preData.length) {
      return false;
    }

    if (
      cur.meta && cur.meta && cur.meta.pagination
      && pre.meta && pre.meta && pre.meta.pagination
      && pre.meta.pagination.current_page !== cur.meta.pagination.current_page
    ) {
      return false;
    }

    for (const datum of preData) {
      const newDatum = curData.find((d) =>
        (digger(unique, d) || []).pop() === (digger(unique, datum) || []).pop()
      );
      if (!newDatum) {
        return false;
      }

      if (!isEqual(datum, newDatum)) {
        Object.assign(datum, newDatum);
      }
    }

    return true;
  });
}


@Injectable({
  providedIn: 'any'
})
export class NgApiResourceService<T extends ResourceModel> {

  resourceName = '';
  prefix = NgApiWrapperService.prefix ? (NgApiWrapperService.prefix) + '/' : '';
  parentPrefix = '';
  defaultServer;
  defaultVersion;
  accessor;
  filters = {};
  adapters: {
    [key: string]: {
      up?: (value, body?, method?: 'get' | 'create' | 'update' | 'delete') => any;
      down?: (value, body) => any;
    }
  } = {};

  page$: Observable<ResourcePage<T>>;
  model$: Observable<ResourceItem<T>>;
  cachedModel$ = new BehaviorSubject<ResourceItem<T>>(null);
  refresher$ = new BehaviorSubject(null);
  loadmore$ = new BehaviorSubject(null);
  lastPage = false;

  downAdapt(data: any) {
    for (const key of Object.keys(this.adapters)) {
      if (!this.adapters[key].down) {
        continue;
      }
      const keys = key.split(/\[\s*([\w]+)\s*]/g)
        .filter(f => f !== '');
      keys.reduce((pointer, k, i) => {
        if (pointer !== undefined) {
          if (i < keys.length - 1) {
            return pointer[k];
          } else {
            pointer[k + '[adapted]'] = this.adapters[key].down(pointer[k], data);
          }
        }
        return pointer;
      }, data);
    }
    return data;
  }

  upAdapt(data: any, method) {
    for (const key of Object.keys(this.adapters)) {
      if (!this.adapters[key].up) {
        continue;
      }
      const keys = key.split(/\[\s*([\w]+)\s*]/g)
        .filter(f => f !== '');
      keys.reduce((pointer, k, i) => {
        if (pointer !== undefined) {
          if (i < keys.length - 1) {
            return pointer[k];
          } else {
            pointer[k] = this.adapters[key].up(pointer[k], data, method);
          }
        }
        return pointer;
      }, data);
    }
    return data;
  }


  constructor(protected http: NgApiWrapperService) {
  }

  transformer(t: T): T {
    return t;
  }

  setPrefix(prefix: string, ignoreBackend = false) {
    this.prefix = ignoreBackend ? prefix : NgApiWrapperService.prefix + '/' + prefix;
    return this;
  }

  where(field, value) {
    this.filters[field] = value;
    return this;
  }

  get(filters = {}) {
    let body = {...this.filters, ...filters};
    body = this.upAdapt(body, 'get');
    return this.http.get<ResourcePage<T>>({
      version: this.defaultVersion,
      server: this.defaultServer,
      prefix: this.prefix + this.parentPrefix,
      path: this.resourceName,
      body
    })
      .pipe(
        map((resource: any) => {
          if (!(Object.keys(resource).includes('data'))) {
            if (Object.keys(resource).includes(this.accessor)) {
              // @ts-ignore
              resource.data = resource[this.accessor];
              delete resource[this.accessor];
            } else {
              // @ts-ignore
              resource.data = resource;
            }
          }

          if (!(Object.keys(resource).includes('meta')
            && Object.keys(resource.meta).includes('pagination'))
            && Object.keys(resource).includes('current_page')) {
            // @ts-ignore
            resource.meta = resource.meta || {};
          }

          resource.data = resource.data.map(d => this.downAdapt(d));
          resource.data = resource.data.map(d => this.transformer(d));
          return resource as ResourcePage<T>;
        })
      );
  }

  find(id) {
    return this.http.get<ResourceItem<T>>({
      version: this.defaultVersion, server: this.defaultServer,
      prefix: this.prefix + this.parentPrefix,
      path: this.resourceName + '/' + id,
      body: this.filters
    })
      .pipe(
        map((resource: any) => {
          if (!('data' in resource)) {
            // @ts-ignore
            resource.data = resource;
          }
          resource.data = this.downAdapt(resource.data);
          resource.data = this.transformer(resource.data);
          return resource as ResourceItem<T>;
        })
      );
  }

  create(body) {
    body = this.upAdapt(body, 'create');
    return this.http.post({
      version: this.defaultVersion,
      server: this.defaultServer,
      prefix: this.prefix + this.parentPrefix,
      path: this.resourceName,
      body
    });
  }

  update(id, body) {
    body = this.upAdapt(body, 'update');
    return this.http.patch({
      version: this.defaultVersion,
      server: this.defaultServer,
      prefix: this.prefix + this.parentPrefix,
      path: this.resourceName + '/' + id,
      body
    });
  }

  delete(id: number, body: any = {}) {
    body = this.upAdapt(body, 'update');
    return this.http.delete({
      version: this.defaultVersion,
      server: this.defaultServer,
      prefix: this.prefix + this.parentPrefix,
      path: this.resourceName + '/' + id,
      body
    });
  }

  toggle(id, body: any = {}) {
    body = this.upAdapt(body, 'update');
    return this.http.patch({
      version: this.defaultVersion, server: this.defaultServer,
      prefix: this.prefix + this.parentPrefix,
      path: this.resourceName + '/' + id + '/toggle',
      body
    });
  }

  init(options?: {
    route?: ActivatedRoute;
    refresher$?: BehaviorSubject<any>;
    filters?: string[];
    idParameter?: string;
    uniqueId?: string,
    loadmore?: boolean;
    parent?: NgApiResourceService<any>,
  }) {
    let pagination: ResourcePagination = null;
    this.refresher$ = options?.refresher$ || this.refresher$;
    this.page$ =
      this.refresher$
        .pipe(
          switchMap(() => {
            if (!options?.parent) {
              this.parentPrefix = '';
              return of(null);
            }
            return options.parent.cachedModel$
              .pipe(
                filter(parent => !!parent),
                tap(parent => this.parentPrefix += options.parent.resourceName + parent.data.id),
              );
          }),
          switchMap(() => options?.route?.queryParams || of({})),
          switchMap(filters => {
            if (options?.loadmore) {
              this.lastPage = false;
              pagination = null;
              return this.loadmore$
                .pipe(
                  filter(() => !this.lastPage),
                  map(() =>
                    ({...filters, page: (pagination?.current_page || 0) + 1})
                  )
                );
            }
            return of(filters);
          }),
          switchMap(filters => {
            const newFilters = options?.filters?.length ? {} : {...filters};
            for (const key of Object.keys(filters)) {
              if (options?.filters?.includes(key)) {
                newFilters[key] = filters[key];
              }
            }
            return this.get(newFilters);
          }),
          tap(page => this.lastPage =
            Math.ceil(page?.meta?.pagination?.total / page?.meta?.pagination?.per_page)
            <= page?.meta?.pagination?.current_page),
          distinctUntilChanged((pre, cur) => {
            if (options?.loadmore) {
              if (!cur?.meta?.pagination) {
                this.lastPage = true;
                return false;
              }

              if (
                Math.ceil(cur?.meta?.pagination?.total / cur?.meta?.pagination?.per_page) >= cur?.meta?.pagination?.current_page
              ) {
                pagination = cur.meta.pagination;
                pre.data.unshift(...cur.data);
                cur.data = pre.data;
              }
            }
            return false;
          }),
          smartResourcePageRefresh<T>(options?.uniqueId),
        );

    this.model$ =
      this.refresher$
        .pipe(
          switchMap(() => {
            if (!options?.parent) {
              this.parentPrefix = '';
              return of(null);
            }
            return options.parent.cachedModel$
              .pipe(
                filter(parent => !!parent),
                tap(parent => this.parentPrefix += options.parent.resourceName + parent.data.id),
              );
          }),
          switchMap(() => options?.route?.params || of({})),
          switchMap(params => this.find(params[options?.idParameter])),
          tap(model => this.cachedModel$.next(model)),
        );
  }

  superviseRefreshers(...services: NgApiResourceService<any>[]) {
    services.forEach(service => service.refresher$ = this.refresher$);
  }
}
