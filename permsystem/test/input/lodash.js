;(function() {

function overArg(func, transform) {
            return function (arg) {
                return func(transform(arg));
            };
        }

var getPrototype = overArg(Object.getPrototypeOf, Object);
});