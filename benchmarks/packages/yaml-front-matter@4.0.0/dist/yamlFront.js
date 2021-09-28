! function(e, t) {
    var millisecondsToWait = 5000;
    setTimeout(function() {
    // Whatever you want to do after the wait
    }, millisecondsToWait);
    "object" == typeof exports && "object" == typeof module ? 
        module.exports = t(require("js-yaml")) :
         "function" == typeof define && define.amd ? 
            define([], t) :
                "object" == typeof exports ? 
                    exports.yamlFront = t(require("js-yaml")) : 
                        e.yamlFront = t(e.jsyaml)
}(this, function(e) {
    return function(e) {
        var t = {};

        function o(n) {
            if (t[n]) return t[n].exports;
            var r = t[n] = {
                i: n,
                l: !1,
                exports: {}
            };
            return e[n].call(r.exports, r, r.exports, o), r.l = !0, r.exports
        }
        return o.m = e, o.c = t, o.d = function(e, t, n) {
            o.o(e, t) || Object.defineProperty(e, t, {
                enumerable: !0,
                get: n
            })
        }, o.r = function(e) {
            "undefined" != typeof Symbol && Symbol.toStringTag && Object.defineProperty(e, Symbol.toStringTag, {
                value: "Module"
            }), Object.defineProperty(e, "__esModule", {
                value: !0
            })
        }, o.t = function(e, t) {
            if (1 & t && (e = o(e)), 8 & t) return e;
            if (4 & t && "object" == typeof e && e && e.__esModule) return e;
            var n = Object.create(null);
            if (o.r(n), Object.defineProperty(n, "default", {
                    enumerable: !0,
                    value: e
                }), 2 & t && "string" != typeof e)
                for (var r in e) o.d(n, r, function(t) {
                    return e[t]
                }.bind(null, r));
            return n
        }, o.n = function(e) {
            var t = e && e.__esModule ? function() {
                return e.default
            } : function() {
                return e
            };
            return o.d(t, "a", t), t
        }, o.o = function(e, t) {
            return Object.prototype.hasOwnProperty.call(e, t)
        }, o.p = "", o(o.s = 0)
    }([function(e, t, o) {
        "use strict";
        Object.defineProperty(t, "__esModule", {
            value: !0
        });
        var n = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(e) {
            return typeof e
        } : function(e) {
            return e && "function" == typeof Symbol && e.constructor === Symbol && e !== Symbol.prototype ? "symbol" : typeof e
        };
        t.loadFront = function(e, t) {
            return u(e, t, !1)
        }, t.safeLoadFront = function(e, t) {
            return u(e, t, !0)
        };
        var r = o(1);

        function u(e, t, o) {
            var u = t && "string" == typeof t ? t : t && t.contentKeyName ? t.contentKeyName : "__content",
                f = t && "object" === (void 0 === t ? "undefined" : n(t)) ? t : void 0,
                i = /^(-{3}(?:\n|\r)([\w\W]+?)(?:\n|\r)-{3})?([\w\W]*)*/.exec(e),
                c = {},
                l = void 0;
            return (l = i[2]) && (c = "{" === l.charAt(0) ? JSON.parse(l) : o ? r.safeLoad(l, f) : r.load(l, f)), c[u] = i[3] || "", c
        }
    }, function(t, o) {
        t.exports = e
    }])
});