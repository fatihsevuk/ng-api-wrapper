# Object Digger

This library is used to parse an accessor string with a given context object.

for example: 
    
    const context = {
        "name" : {
            "value": "Ali Baba",
            "operator": "LIKE"
        },
        "phone": "000221133456"
    };
    
    console.log(digger("name.value", context));

_output:_

    ["Ali Baba"] 
    
#### String Parser

The string parser can be used just like `handlebar mustache` syntax with a given context object, which would return a string with the accessors being resolved and parsed.

    console.log(diggerStringParser("Hi, my name is [[name.value]] and my phone number is [[phone]]", context));
    console.log(diggerStringParser("Hi, my name is {{name.value}} and my phone number is {{phone}}", context, 'curly-brackets'));
    console.log(diggerStringParser("Hi, my name is ``name.value`` and my phone number is ``phone``", context, 'backticks'));

_output:_

    "Hi, my name is Ali Baba and my phone number is 000221133456" 


that's it just install with `npm i @monabbous/object-digger` and start digging :D
