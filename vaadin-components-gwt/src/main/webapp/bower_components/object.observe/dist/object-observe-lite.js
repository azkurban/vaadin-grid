/*!
 * Object.observe "lite" polyfill - v0.2.1
 * by Massimo Artizzu (MaxArt2501)
 *
 * https://github.com/MaxArt2501/object-observe
 *
 * Licensed under the MIT License
 * See LICENSE for details
 */

// Some type definitions
/**
 * This represents the data relative to an observed object
 * @typedef  {Object}                     ObjectData
 * @property {Map<Handler, HandlerData>}  handlers
 * @property {String[]}                   properties
 * @property {*[]}                        values
 * @property {Notifier}                   notifier
 */
/**
 * Function definition of a handler
 * @callback Handler
 * @param {ChangeRecord[]}                changes
*/
/**
 * This represents the data relative to an observed object and one of its
 * handlers
 * @typedef  {Object}                     HandlerData
 * @property {Map<Object, ObservedData>}  observed
 * @property {ChangeRecord[]}             changeRecords
 */
/**
 * @typedef  {Object}                     ObservedData
 * @property {String[]}                   acceptList
 * @property {ObjectData}                 data
*/
/**
 * Type definition for a change. Any other property can be added using
 * the notify() or performChange() methods of the notifier.
 * @typedef  {Object}                     ChangeRecord
 * @property {String}                     type
 * @property {Object}                     object
 * @property {String}                     [name]
 * @property {*}                          [oldValue]
 * @property {Number}                     [index]
 */
/**
 * Type definition for a notifier (what Object.getNotifier returns)
 * @typedef  {Object}                     Notifier
 * @property {Function}                   notify
 * @property {Function}                   performChange
 */
/**
 * Function called with Notifier.performChange. It may optionally return a
 * ChangeRecord that gets automatically notified, but `type` and `object`
 * properties are overridden.
 * @callback Performer
 * @returns {ChangeRecord|undefined}
 */

Object.observe || (function(O, A, root) {
    "use strict";

        /**
         * Relates observed objects and their data
         * @type {Map<Object, ObjectData}
         */
    var observed,
        /**
         * List of handlers and their data
         * @type {Map<Handler, Map<Object, HandlerData>>}
         */
        handlers,

        defaultAcceptList = [ "add", "update", "delete", "reconfigure", "setPrototype", "preventExtensions" ];

    // Functions for internal usage

        /**
         * Checks if the argument is a Node object. Uses duck typing if Node is
         * not defined.
         * @function isNode
         * @param {?*} node
         * @returns {Boolean}
         */
    var isNode = root.Node ? function(node) {
            return node && node instanceof root.Node;
        } : function(node) {
            // Duck typing
            return node && typeof node === "object"
                    && typeof node.nodeType === "number"
                    && typeof node.nodeName === "string";
        },

        /**
         * Checks if the argument is an Array object. Polyfills Array.isArray.
         * @function isArray
         * @param {?*} object
         * @returns {Boolean}
         */
        isArray = A.isArray || (function(toString) {
            return function (object) { return toString.call(object) === "[object Array]"; };
        })(O.prototype.toString),

        /**
         * Returns the index of an item in a collection, or -1 if not found.
         * Uses Array.prototype.indexOf is available.
         * @function inArray
         * @param {*} pivot           Item to look for
         * @param {Array} array
         * @param {Number} [start=0]  Index to start from
         * @returns {Number}
         */
        inArray = A.prototype.indexOf ? function(pivot, array, start) {
            return array.indexOf(pivot, start);
        } : function(pivot, array, start) {
            for (var i = start || 0; i < array.length; i++)
                if (array[i] === pivot)
                    return i;
            return -1;
        },

        /**
         * Returns an instance of Map, or a Map-like object is Map is not
         * supported or doesn't support forEach()
         * @function createMap
         * @returns {Map}
         */
        createMap = typeof root.Map === "undefined" || !Map.prototype.forEach ? function() {
            // Lightweight shim of Map. Lacks clear(), entries(), keys() and
            // values() (the last 3 not supported by IE11, so can't use them),
            // it doesn't handle the constructor's argument (like IE11) and of
            // course it doesn't support for...of.
            // Chrome 31-35 and Firefox 13-24 have a basic support of Map, but
            // they lack forEach(), so their native implementation is bad for
            // this polyfill. (Chrome 36+ supports Object.observe.)
            var keys = [], values = [];

            return {
                size: 0,
                has: function(key) { return inArray(key, keys) > -1; },
                get: function(key) { return values[inArray(key, keys)]; },
                set: function(key, value) {
                    var i = inArray(key, keys);
                    if (i === -1) {
                        keys.push(key);
                        values.push(value);
                        this.size++;
                    } else values[i] = value;
                },
                "delete": function(key) {
                    var i = inArray(key, keys);
                    if (i > -1) {
                        keys.splice(i, 1);
                        values.splice(i, 1);
                        this.size--;
                    }
                },
                forEach: function(callback/*, thisObj*/) {
                    for (var i = 0; i < keys.length; i++)
                        callback.call(arguments[1], values[i], keys[i], this);
                }
            };
        } : function() { return new Map(); },

        /**
         * Simple shim for Object.keys is not available
         * Misses checks on object, don't use as a replacement of Object.keys
         * @function getKeys
         * @param {Object} object
         * @returns {String[]}
         */
        getKeys = O.keys || function(object) {
            var keys = [], prop;
            for (prop in object)
                if (object.hasOwnProperty(prop))
                    keys.push(prop);
            return keys;
        },

        /**
         * Sets up the next check and delivering iteration, using
         * requestAnimationFrame or a (close) polyfill.
         * @function nextFrame
         * @param {function} func
         * @returns {number}
         */
        nextFrame = root.requestAnimationFrame || root.webkitRequestAnimationFrame || (function() {
            var initial = +new Date,
                last = initial;
            return function(func) {
                var now = +new Date;
                return setTimeout(function() {
                    func((last = +new Date) - initial);
                }, 17);
            };
        })(),

        /**
         * Sets up the observation of an object
         * @function doObserve
         * @param {Object} object
         * @param {Handler} handler
         * @param {String[]} [acceptList]
         */
        doObserve = function(object, handler, acceptList) {

            var data = observed.get(object);

            if (data)
                setHandler(object, data, handler, acceptList);
            else {
                data = createObjectData(object);
                setHandler(object, data, handler, acceptList);

                if (observed.size === 1)
                    // Let the observation begin!
                    nextFrame(runGlobalLoop);
            }
        },

        /**
         * Creates the initial data for an observed object
         * @function createObjectData
         * @param {Object} object
         */
        createObjectData = function(object, data) {
            var props = isNode(object) ? [] : getKeys(object),
                values = [], descs, i = 0,
                data = {
                    handlers: createMap(),
                    properties: props,
                    values: values,
                    notifier: retrieveNotifier(object, data)
                };

            while (i < props.length)
                values[i] = object[props[i++]];

            observed.set(object, data);

            return data;
        },

        /**
         * Performs basic property value change checks on an observed object
         * @function performPropertyChecks
         * @param {ObjectData} data
         * @param {Object} object
         * @param {String} [except]  Doesn't deliver the changes to the
         *                           handlers that accept this type
         */
        performPropertyChecks = function(data, object, except) {
            if (!data.handlers.size) return;

            var props, proplen, keys,
                values = data.values,
                descs = data.descriptors,
                i = 0, idx,
                key, value, ovalue,
                proto, descr;

            props = data.properties.slice();
            proplen = props.length;
            keys = getKeys(object);

            // Check for value additions/changes
            while (i < keys.length) {
                key = keys[i++];
                idx = inArray(key, props);
                value = object[key];

                if (idx === -1) {
                    addChangeRecord(object, data, {
                        name: key,
                        type: "add",
                        object: object
                    }, except);
                    data.properties.push(key);
                    values.push(value);
                } else {
                    ovalue = values[idx];
                    props[idx] = null;
                    proplen--;
                    if (ovalue === value ? ovalue === 0 && 1/ovalue !== 1/value
                            : ovalue === ovalue || value === value) {
                        addChangeRecord(object, data, {
                            name: key,
                            type: "update",
                            object: object,
                            oldValue: ovalue
                        }, except);
                        data.values[idx] = value;
                    }
                }
            }

            // Checks if some property has been deleted
            for (i = props.length; proplen && i--;)
                if (props[i] !== null) {
                    addChangeRecord(object, data, {
                        name: props[i],
                        type: "delete",
                        object: object,
                        oldValue: values[i]
                    }, except);
                    data.properties.splice(i, 1);
                    data.values.splice(i, 1);
                    proplen--;
                }
        },

        /**
         * Sets up the main loop for object observation and change notification
         * It stops if no object is observed.
         * @function runGlobalLoop
         */
        runGlobalLoop = function() {
            if (observed.size) {
                observed.forEach(performPropertyChecks);
                handlers.forEach(deliverHandlerRecords);
                nextFrame(runGlobalLoop);
            }
        },

        /**
         * Deliver the change records relative to a certain handler, and resets
         * the record list.
         * @param {HandlerData} hdata
         * @param {Handler} handler
         */
        deliverHandlerRecords = function(hdata, handler) {
            if (hdata.changeRecords.length) {
                handler(hdata.changeRecords);
                hdata.changeRecords = [];
            }
        },

        /**
         * Returns the notifier for an object - whether it's observed or not
         * @function retrieveNotifier
         * @param {Object} object
         * @param {ObjectData} [data]
         * @returns {Notifier}
         */
        retrieveNotifier = function(object, data) {
            if (arguments.length < 2)
                data = observed.get(object);

            /** @type {Notifier} */
            return data && data.notifier || {
                /**
                 * @method notify
                 * @see http://arv.github.io/ecmascript-object-observe/#notifierprototype._notify
                 * @memberof Notifier
                 * @param {ChangeRecord} changeRecord
                 */
                notify: function(changeRecord) {
                    changeRecord.type; // Just to check the property is there...

                    // If there's no data, the object has been unobserved
                    var data = observed.get(object);
                    if (data) {
                        var recordCopy = { object: object }, prop;
                        for (prop in changeRecord)
                            if (prop !== "object")
                                recordCopy[prop] = changeRecord[prop];
                        addChangeRecord(object, data, recordCopy);
                    }
                },

                /**
                 * @method performChange
                 * @see http://arv.github.io/ecmascript-object-observe/#notifierprototype_.performchange
                 * @memberof Notifier
                 * @param {String} changeType
                 * @param {Performer} func     The task performer
                 * @param {*} [thisObj]        Used to set `this` when calling func
                 */
                performChange: function(changeType, func/*, thisObj*/) {
                    if (typeof changeType !== "string")
                        throw new TypeError("Invalid non-string changeType");

                    if (typeof func !== "function")
                        throw new TypeError("Cannot perform non-function");

                    // If there's no data, the object has been unobserved
                    var data = observed.get(object),
                        prop, changeRecord,
                        result = func.call(arguments[2]);

                    data && performPropertyChecks(data, object, changeType);

                    // If there's no data, the object has been unobserved
                    if (data && result && typeof result === "object") {
                        changeRecord = { object: object, type: changeType };
                        for (prop in result)
                            if (prop !== "object" && prop !== "type")
                                changeRecord[prop] = result[prop];
                        addChangeRecord(object, data, changeRecord);
                    }
                }
            };
        },

        /**
         * Register (or redefines) an handler in the collection for a given
         * object and a given type accept list.
         * @function setHandler
         * @param {Object} object
         * @param {ObjectData} data
         * @param {Handler} handler
         * @param {String[]} acceptList
         */
        setHandler = function(object, data, handler, acceptList) {
            var hdata = handlers.get(handler), odata;
            if (!hdata)
                handlers.set(handler, hdata = {
                    observed: createMap(),
                    changeRecords: []
                });
            hdata.observed.set(object, {
                acceptList: acceptList.slice(),
                data: data
            });
            data.handlers.set(handler, hdata);
        },

        /**
         * Adds a change record in a given ObjectData
         * @function addChangeRecord
         * @param {Object} object
         * @param {ObjectData} data
         * @param {ChangeRecord} changeRecord
         * @param {String} [except]
         */
        addChangeRecord = function(object, data, changeRecord, except) {
            data.handlers.forEach(function(hdata) {
                var acceptList = hdata.observed.get(object).acceptList;
                // If except is defined, Notifier.performChange has been
                // called, with except as the type.
                // All the handlers that accepts that type are skipped.
                if ((typeof except !== "string"
                        || inArray(except, acceptList) === -1)
                        && inArray(changeRecord.type, acceptList) > -1)
                    hdata.changeRecords.push(changeRecord);
            });
        };

    observed = createMap();
    handlers = createMap();

    /**
     * @function Object.observe
     * @see http://arv.github.io/ecmascript-object-observe/#Object.observe
     * @param {Object} object
     * @param {Handler} handler
     * @param {String[]} [acceptList]
     * @throws {TypeError}
     * @returns {Object}               The observed object
     */
    O.observe = function observe(object, handler, acceptList) {
        if (object === null || typeof object !== "object")
            throw new TypeError("Object.observe cannot observe non-object");

        if (typeof handler !== "function")
            throw new TypeError("Object.observe cannot deliver to non-function");

        if (O.isFrozen && O.isFrozen(handler))
            throw new TypeError("Object.observe cannot deliver to a frozen function object");

        if (!isArray(acceptList))
            acceptList = defaultAcceptList;

        doObserve(object, handler, acceptList);

        return object;
    };

    /**
     * @function Object.unobserve
     * @see http://arv.github.io/ecmascript-object-observe/#Object.unobserve
     * @param {Object} object
     * @param {Handler} handler
     * @throws {TypeError}
     * @returns {Object}         The given object
     */
    O.unobserve = function unobserve(object, handler) {
        if (object === null || typeof object !== "object")
            throw new TypeError("Object.unobserve cannot unobserve non-object");

        if (typeof handler !== "function")
            throw new TypeError("Object.unobserve cannot deliver to non-function");

        var hdata = handlers.get(handler), odata;

        if (hdata && (odata = hdata.observed.get(object))) {
            hdata.observed.forEach(function(odata, object) {
                performPropertyChecks(odata.data, object);
            });
            nextFrame(function() {
                deliverHandlerRecords(hdata, handler);
            });

            // In Firefox 13-18, size is a function, but createMap should fall
            // back to the shim for those versions
            if (hdata.observed.size === 1 && hdata.observed.has(object))
                handlers["delete"](handler);
            else hdata.observed["delete"](object);

            if (odata.data.handlers.size === 1)
                observed["delete"](object);
            else odata.data.handlers["delete"](handler);
        }

        return object;
    };

    /**
     * @function Object.getNotifier
     * @see http://arv.github.io/ecmascript-object-observe/#GetNotifier
     * @param {Object} object
     * @throws {TypeError}
     * @returns {Notifier}
     */
    O.getNotifier = function getNotifier(object) {
        if (object === null || typeof object !== "object")
            throw new TypeError("Object.getNotifier cannot getNotifier non-object");

        if (O.isFrozen && O.isFrozen(object)) return null;

        return retrieveNotifier(object);
    };

    /**
     * @function Object.deliverChangeRecords
     * @see http://arv.github.io/ecmascript-object-observe/#Object.deliverChangeRecords
     * @see http://arv.github.io/ecmascript-object-observe/#DeliverChangeRecords
     * @param {Handler} handler
     * @throws {TypeError}
     */
    O.deliverChangeRecords = function deliverChangeRecords(handler) {
        if (typeof handler !== "function")
            throw new TypeError("Object.deliverChangeRecords cannot deliver to non-function");

        var hdata = handlers.get(handler);
        if (hdata) {
            hdata.observed.forEach(function(odata, object) {
                performPropertyChecks(odata.data, object);
            });
            deliverHandlerRecords(hdata, handler);
        }
    };

})(Object, Array, this);
