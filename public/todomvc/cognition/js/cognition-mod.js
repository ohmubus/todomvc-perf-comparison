;(function($) {

    /**
     * cognition.js (v1.1.2-rei)
     *
     * Copyright (c) 2015 Scott Southworth, Landon Barnickle, Nick Lorenson & Contributors
     *
     * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this
     * file except in compliance with the License. You may obtain a copy of the License at:
     * http://www.apache.org/licenses/LICENSE-2.0
     *
     * Unless required by applicable law or agreed to in writing, software distributed under
     * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF
     * ANY KIND, either express or implied. See the License for the specific language
     * governing permissions and limitations under the License.
     *
     * @authors Scott Southworth @darkmarmot, Landon Barnickle @landonbar, Nick Lorenson @enlore
     *
     */

    "use strict";
    var cognition = $.cognition = {};
    var bus = $.catbus = catbus;
    var uid = 0;

    var COG_ROOT = bus.demandTree('COG_ROOT');
    var ALIAS_ROOT= bus.demandTree('ALIAS_ROOT');

    var buildNum = 'NEED_BUILD_NUM';

    // cognition data types

    var DATA = 'data';
    var NUMBER = 'number';
    var PROP = 'prop';
    var FEED = 'feed';
    var SERVICE = 'service';
    var STRING = 'string';
    var RUN = 'run';
    var ERROR = 'error';
    var BOOLEAN = 'bool';
    var OBJECT = 'object';
    var READ = 'read';

    // the value attribute of of a data tag can be preceded by one of these:
    var DATA_VALUE_TYPE_HASH = {

        data: DATA,
        num: NUMBER,
        number: NUMBER,
        prop: PROP,
        bool: BOOLEAN,
        boolean: BOOLEAN,
        string: STRING,
        run: RUN,
        error: ERROR,
        read: READ

    };

    cognition.buildNum = function(n){
        if(arguments.length == 0) return buildNum;
        buildNum = n;
        return cognition;
    };


    var defaultScriptDataPrototype = {

        init: function () {
        },
        start: function () {
        },
        destroy: function () {
        }

    };

    var activeScriptData = null;
    var activeProcessURL = null;

    var contentMap = {}; // layout map, built from n-item hierarchy
    var cacheMap = {}; // cache of content url loads
    var declarationMap = {}; // arrays of strategy directives
    var libraryMap = {}; // by resolvedUrl, javascript files processed (don't run again)

    var scriptMap = {}; // prototypes


    var webServiceDefaults = {

        format: 'jsonp',
        post: false

    };


    function destroyInnerMapItems(into){
        for(var k in into.childMap){
            var mi = into.childMap[k];

            destroyMapItem(mi);
        }
    }


    $.cog = function(scriptData){
        activeScriptData = scriptData;
        // add default methods to this nascent prototype if not present
        $.each(defaultScriptDataPrototype, function(name, func){
            if(typeof scriptData[name] !== 'function')
                scriptData[name] = func;
        });
    };

    cognition.init = function (sel, url, debugUrl){

        var root = cognition.root = new MapItem();
        root.aliasZone = ALIAS_ROOT;
        root.cogZone = COG_ROOT;


        bus.defineDeepLinker('lzs', function(dir){ return LZString.compressToEncodedURIComponent(JSON.stringify(dir))},
            function(str){ return JSON.parse(LZString.decompressFromEncodedURIComponent(str))});
        bus.setDeepLinker('lzs');

        var directions = bus.resolveDirections(window.location.search);
        if(directions)
            COG_ROOT.demandData('__DIRECTIONS__').write(directions);

        root.localSel = sel;
        root.createCog({url:url});
        if(debugUrl)
            root.createCog({url: debugUrl});

    };

    function destroyMapItem(mapItem){

        for(var k in mapItem.childMap){
            var mi = mapItem.childMap[k];
            destroyMapItem(mi);
        }

        if(mapItem.parent){
            delete mapItem.parent.childMap[mapItem.uid];
        }

        bus.dropHost(mapItem.uid);
        mapItem.cogZone.drop();

        if(!mapItem.scriptData)
        {
            console.log("what?");
        }

        mapItem.scriptData.destroy();

        if(mapItem.localSel)
            mapItem.localSel.remove();
        mapItem.localSel = null;
        if(mapItem.scriptData)
            mapItem.scriptData.mapItem = null;
        mapItem.scriptData = null;
        mapItem.parent = null;
        mapItem.itemPlace = null;
        mapItem.destroyed = true;
        mapItem.requirements = null;

        var stored = contentMap[mapItem.uid];
        if(stored === mapItem) {
            delete contentMap[mapItem.uid];
            // console.log("destroyed " + mapItem.uid);
        }

    }



    function extractHasAttr2(node, attrName){
        return !!(node && node.attributes.getNamedItem(attrName));
    }


    function extractString2(node, attrNameOrNames, defaultValue){

        var attrValue = determineFirstDefinedAttrValue2(node, attrNameOrNames);
        if(attrValue)
            return attrValue.trim();
        return defaultValue;

    }


    function extractBool2(node, attrNameOrNames, defaultValue){

        var attrValue = determineFirstDefinedAttrValue2(node, attrNameOrNames);

        if(attrValue === undefined)
            return defaultValue;
        if(attrValue === 'true')
            return true;
        if(attrValue === 'false')
            return false;

        throwParseError(node, 'bool', attrNameOrNames);

    }



    function extractStringArray2(node, attrNameOrNames){

        var attrValue = determineFirstDefinedAttrValue2(node, attrNameOrNames);
        if(attrValue)
            return stringToStringArray(attrValue);
        return [];

    }

    function stringToStringArray(str){

        var arr = str.split(',');

        for(var i = arr.length - 1; i >= 0; i--){
            var chunk = arr[i];
            var trimmed_chunk = chunk.trim();
            if(!trimmed_chunk)
                arr.splice(i, 1);
            else if(trimmed_chunk.length !== chunk.length)
                arr.splice(i, 1, trimmed_chunk);
        }

        return arr;

    }


    function determineFirstDefinedAttrValue2(node, attrNameOrNames){

        var arr = stringToStringArray(attrNameOrNames);
        var atts = node.attributes;
        for(var i = 0; i < arr.length; i++){
            var att = atts.getNamedItem(arr[i]);
            if(att)
                return att.value;
        }
        return undefined;
    }



    function extractCommandDef2(node){

        var d = {

            name: extractString2(node, 'name'),
            pipe: extractString2(node, 'pipe'),
            toggle: extractString2(node, 'toggle'),
            filter: extractString2(node, 'filter'),
            topic: extractString2(node, 'on', 'update'),
            run: extractString2(node, 'run'),
            emit: extractString2(node, 'emit'),
            emitPresent: extractHasAttr2(node, 'emit'),
            emitType: null,
            once: extractBool2(node, 'once'),
            change: extractBool2(node, 'change', false),
            extract: extractString2(node, 'extract'),
            transform: extractString2(node, 'transform'),
            transformPresent: extractHasAttr2(node, 'transform'),
            transformType: null,
            adapt: extractString2(node, 'adapt'),
            adaptPresent: extractHasAttr2(node, 'adapt'),
            adaptType: null,
            autorun: false,
            batch: extractBool2(node, 'batch'),
            keep: 'last', // first, all, or last
            need: extractStringArray2(node, 'need'),
            gather: extractStringArray2(node, 'gather'),
            defer: extractBool2(node, 'defer')

        };

        d.watch = [d.name];

        // gather needs and cmd -- only trigger on cmd
        if(d.gather.length || d.need.length) {
            d.gather.push(d.name);

            for (var i = 0; i < d.need.length; i++) {
                var need = d.need[i];
                if (d.gather.indexOf(need) === -1)
                    d.gather.push(need);
            }
        }

        d.batch = d.batch || d.run;
        d.group = d.batch; // todo make new things to avoid grouping and batching with positive statements
        d.retain = d.group;

        applyFieldType(d, 'transform', PROP);
        applyFieldType(d, 'emit', STRING);
        applyFieldType(d, 'adapt', PROP);

        return d;

    }


    function extractSensorDef2(node){

        var d = {

            name: extractString2(node, 'data'),
            cmd: extractString2(node, 'cmd'),
            watch: extractStringArray2(node, 'watch'),
            detect: extractString2(node, 'detect'),
            data: extractString2(node, 'data'),
            find: extractString2(node, 'id,find,node'), // todo switch all to id
            optional: extractBool2(node, 'optional'),
            where: extractString2(node, 'from,where', 'first'),
            pipeWhere: extractString2(node, 'to', 'first'),
            thing: extractString2(node, 'is', 'data'), // data, feed, service
            pipe: extractString2(node, 'pipe'),
            toggle: extractString2(node, 'toggle'),
            demand: extractString2(node, 'demand'),
            filter: extractString2(node, 'filter'),
            topic: extractString2(node, 'for,on,topic', 'update'),
            run: extractString2(node, 'run'),
            emit: extractString2(node, 'emit'),
            emitPresent: extractHasAttr2(node, 'emit'),
            emitType: null,
            once: extractBool2(node, 'once'),
            retain: extractBool2(node, 'retain'), // opposite of forget, now the default
            forget: extractBool2(node, 'forget'), // doesn't retain group hash values from prior flush events
            fresh: extractBool2(node, 'fresh'), // send only fresh, new values (does not autorun with preexisting data)
            separate: extractBool2(node, 'separate'), // turns off automatic batching and grouping
            group: extractBool2(node, 'group'),
            change: extractBool2(node, 'change,distinct,skipDupes', false),
            extract: extractString2(node, 'extract'),
            transform: extractString2(node, 'transform'),
            transformPresent: extractHasAttr2(node, 'transform'),
            transformType: null,
            adapt: extractString2(node, 'adapt'),
            adaptPresent: extractHasAttr2(node, 'adapt'),
            adaptType: null,
            autorun: extractBool2(node, 'now,auto,autorun'),
            batch: extractBool2(node, 'batch'),
            keep: extractString2(node, 'keep', 'last'), // first, all, or last
            need: extractStringArray2(node, 'need,needs'),
            gather: extractStringArray2(node, 'gather'),
            defer: extractBool2(node, 'defer')

        };

        var i;

        // add needs to the watch
        for(i = 0; i < d.need.length; i++){
            var need = d.need[i];
            if(d.watch.indexOf(need) === -1)
                d.watch.push(need);
        }

        // add cmd to the watch list
        if(d.cmd && d.watch.indexOf(d.cmd) === -1)
            d.watch.push(d.cmd);

        // add watches to the gathering -- if gathering
        if(d.gather.length > 0) {
            for (i = 0; i < d.watch.length; i++) {
                var watch = d.watch[i];
                if (d.gather.indexOf(watch) === -1)
                    d.gather.push(watch);
            }
        }

        if(!d.find && !d.cmd && !d.fresh) // && d.watch.length > 0)
            d.autorun = true;

        d.batch = !d.separate && (d.batch || (d.watch.length > 1));
        d.group = d.batch; // todo make new things to avoid grouping and batching with positive statements
        d.retain = d.group;

        applyFieldType(d, 'transform', PROP);
        applyFieldType(d, 'emit', STRING);
        applyFieldType(d, 'adapt', PROP);

        return d;

    }


    function extractPropDef2(node){

        var d = {
            find: extractString2(node, 'find'),
            thing: extractString2(node, 'is', 'data'),
            where: extractString2(node, 'where', 'first'),
            optional: extractBool2(node, 'optional'),
            name: extractString2(node, 'name')
        };

        d.name = d.name || d.find;
        return d;

    }


    function extractWriteDef2(node){
        return {
            name: extractString2(node, 'name'),
            thing: extractString2(node, 'is', 'data'),
            where: extractString2(node, 'where', 'first'),
            value: extractString2(node, 'value')
        };
    }


    function extractAdapterDef2(node){

        var d =  {
            name: extractString2(node, 'name'),
            control: extractBool2(node, 'control'),
            optional: extractBool2(node, 'optional'),
            field: extractString2(node, 'field'),
            fieldType: null,
            item: extractString2(node, 'item')
            // todo -- add dynamic adapter that rewires?
        };

        d.name = d.name || d.field;
        d.field = d.field || d.name;

        applyFieldType(d, 'field', STRING);


        return d;
    }


    function extractValveDef2(node){
        return {
            allow: extractStringArray2(node, 'allow'),
            thing: extractString2(sel, 'is', 'data')
        };
    }

    function extractLibraryDef2(node){
        return {
            name: null,
            url: extractStringArray2(node, 'url'),
            path: extractString2(node, 'path'),
            isRoute: false,
            isAlloy: false,
            isLibrary: true,
            isPreload: false,
            preload: false
        };
    }


    function extractPreloadDef2(node){
        return {
            name: null,
            url: extractStringArray2(node, 'url'),
            path: extractString2(node, 'path'),
            isRoute: false,
            isAlloy: false,
            isLibrary: false,
            isPreload: true,
            preload: true
        };
    }


    function extractAlloyDef2(node){

        var d = {
            url: extractString2(node, 'url'),
            path: extractString2(node, 'path'),
            name: extractString2(node, 'name'),
            isRoute: extractBool2(node, 'route'),
            source: extractString2(node, 'source'),
            item: extractString2(node, 'item','itemData'),
            isAlloy: true,
            isLibrary: false,
            isPreload: false,
            preload: false
        };

        applyFieldType(d,'source', DATA);
        applyFieldType(d,'item', DATA);

        return d;
    }



    function extractServiceDef2(node){

        var d = {
            name: extractString2(node, 'name'),
            to: extractString2(node, 'to'),
            url: extractString2(node, 'url'),
            path: extractString2(node, 'path'),
            topic: extractString2(node, 'on,topic'),
            run: extractString2(node, 'run'),
            post: extractBool2(node, 'post'),
            format: extractString2(node, 'format', 'jsonp'),
            request: extractBool2(node, 'req,request'),
            prop: extractBool2(node, 'prop')
        };


        return d;

    }


    function extractDefaultFeedDefFromServiceDef(def){
        return {
            name: def.name,
            to: def.to,
            service: def.name
        };
    }

    function extractCogDef2(node){

        var d = {

            path: extractString2(node, "path"),
            name: extractString2(node, "name"),
            isRoute: extractBool2(node, "route"),
            url: extractString2(node, "url"),
            source: extractString2(node, 'use') || extractString2(node, 'from,source'),
            item: extractString2(node, 'make') || extractString2(node, 'to,item','cog'),
            target: extractString2(node, "id,find"),
            action: extractString2(node, "and", 'append')

        };

        applyFieldType(d,'url');
        applyFieldType(d,'source', DATA);
        applyFieldType(d,'item', DATA);

        return d;

    }

    function extractChainDef2(node){

        var d = {
            path: extractString2(node, "path"),
            name: extractString2(node, "name"),
            isRoute: extractBool2(node, "route"),
            url: extractString2(node, "url"),
            prop: extractBool2(node, 'prop'),
            source: extractString2(node, "from,source"),
            item: extractString2(node, "to,value,item",'cog'),
            key: extractString2(node, "key"),
            build: extractString2(node, 'build', 'append'), // scratch, append, sort
            order: extractBool2(node, 'order'), // will use flex order css
            depth: extractBool2(node, 'depth'), // will use z-index
            target: extractString2(node, "node,id,find")

        };

        applyFieldType(d, 'source', DATA);
        applyFieldType(d, 'item', DATA);

        return d;

    }



    function extractFeedDef2(node){

        var d = {
            service: extractString2(node, 'service'),
            to: extractString2(node, 'to,data'), // todo decide on to or data
            request: extractBool2(node, 'req,request'),// todo change to extractBool and test
            name: extractString2(node, 'name', false),
            prop: extractBool2(node, 'prop', false)
        };

        d.name = d.name || d.service;

        return d;

    }


    function extractDataDef2(node){

        var d = {
            name: extractString2(node, 'name'),
            inherit: extractBool2(node, 'inherit'),
            isRoute: extractBool2(node, 'route'),
            value: extractString2(node, 'value'),
            valuePresent: extractHasAttr2(node, 'value'),
            valueType: null,
            adapt: extractString2(node, 'adapt'),
            adaptType: null,
            adaptPresent: extractHasAttr2(node, 'adapt'),
            service: extractString2(node, 'service'),
            serviceType: null,
            servicePresent: extractHasAttr2(node, 'service'),
            params: extractString2(node, 'params'),
            paramsType: null,
            paramsPresent: extractHasAttr2(node, 'params'),
            url: extractString2(node, 'url'),
            path: extractString2(node, 'path'),
            verb: extractString2(node, 'verb'),
            prop: extractBool2(node, 'prop'),
            request: extractBool2(node, 'req,request', false) // todo support data loc sensored, if object then acts as params in request
        };

        applyFieldType(d, 'value');
        applyFieldType(d, 'params', PROP);
        applyFieldType(d, 'service');
        applyFieldType(d, 'adapt', PROP);

        return d;

    }


    function extractNetDef2(node){

        var d = {
            name: extractString2(node, 'name'),
            inherit: extractBool2(node, 'inherit'),
            isRoute: extractBool2(node, 'route'),
            value: extractString2(node, 'value'),
            valuePresent: extractHasAttr2(node, 'value'),
            valueType: null,
            adapt: extractString2(node, 'adapt'),
            adaptType: null,
            adaptPresent: extractHasAttr2(node, 'adapt'),
            service: extractString2(node, 'service'),
            serviceType: null,
            servicePresent: extractHasAttr2(node, 'service'),
            params: extractString2(node, 'params'),
            paramsType: null,
            paramsPresent: extractHasAttr2(node, 'params'),
            url: extractString2(node, 'url'),
            path: extractString2(node, 'path'),
            verb: extractString2(node, 'verb'),
            prop: extractBool2(node, 'prop'),
            request: extractBool2(node, 'req,request', false) // todo support data loc sensored, if object then acts as params in request
        };

        applyFieldType(d, 'value');
        applyFieldType(d, 'params', PROP);
        applyFieldType(d, 'service');
        applyFieldType(d, 'adapt', PROP);

        return d;

    }

    function stringToSimpleValue(str){

        if(str === 'true'){
            return true;
        } else if(str === 'false'){
            return false;
        } else if(str === 'null'){
            return null;
        } else if(str === '[]'){
            return [];
        } else if(str === '{}'){
            return {};
        } else {
            return str;
        }

    }

    function stringToPrimitive(str, type) {

        if(type === BOOLEAN) {
            return (str === 'true');
        } else if (type === NUMBER) {
            return Number(str);
        } else {
            return str;
        }
    }

    function applyFieldType(d, fieldName, defaultType){

        var str = d[fieldName];
        if(str === undefined) // field was not defined, don't need to assign a type
            return;

        var fieldTypeName = fieldName + "Type";
        var chunks = str.split(" ");

        var typeDeclared = chunks.length > 0 && DATA_VALUE_TYPE_HASH[chunks[0]];
        var type = typeDeclared || defaultType;

        d[fieldTypeName] = type;

        if(chunks.length === 1) { // no prefix for data type given, implicitly coerce to bool or null if appropriate
            d[fieldName] = (type) ? str : stringToSimpleValue(str);
        } else {
            if(typeDeclared) // check to avoid removing part of a string with spaces that didn't specify a type
                chunks.shift();
            str = chunks.join(' ');
            d[fieldName] = stringToPrimitive(str, type);
        }

    }


    function extractAliasDef2(node){

        return {
            name: extractString2(node, 'name'),
            path: extractString2(node, 'path'),
            url: extractString2(node, 'url'),
            prop: extractBool2(node, 'prop')
        };

    }


    function extractMethodDef2(node){

        var d = {
            name: extractString2(node, 'name'),
            func: extractString2(node, 'func'),
            bound: extractBool2(node, 'bound')
        };

        d.name = d.name || d.func;
        d.func = d.func || d.name;

        return d;
    }

    function extractDeclarations(sel){

        var decs = {};

        function getDefs2(source, extractor, multiName){

            var result = [];

            if(!source)
                return result;

            for(var i = 0; i < source.length; i++){
                var node = source[i];
                var def = extractor(node);
                if(multiName) {
                    for(var j = 0; j < def.url.length; j++){
                        var def2 = copyProps(def, {});
                        def2.url = def.url[j];
                        result.push(def2);
                    }
                } else {
                    result.push(def);
                }
            }

            return result;
        }

        decs.aliases = [].concat(getDefs2(sel.alias, extractAliasDef2));
        decs.adapters = [].concat(getDefs2(sel.adapter, extractAdapterDef2));
        decs.valves = [].concat(getDefs2(sel.valve, extractValveDef2));
        decs.dataSources = [].concat(getDefs2(sel.data, extractDataDef2));
        decs.dataSources = decs.dataSources.concat(getDefs2(sel.net, extractNetDef2));
        decs.services = [].concat(getDefs2(sel.service, extractServiceDef2));
        decs.feeds = [].concat(getDefs2(sel.feed, extractFeedDef2));
        decs.methods = [].concat(getDefs2(sel.method, extractMethodDef2));
        decs.properties = [].concat(getDefs2(sel.prop, extractPropDef2));
        decs.sensors = [].concat(getDefs2(sel.sensor, extractSensorDef2));
        var commandDefs = getDefs2(sel.command, extractCommandDef2);
        decs.sensors = decs.sensors.concat(commandDefs);

        decs.commands = [];
        for(var i = 0; i < commandDefs.length; i++){
            var def = commandDefs[i];
            decs.commands.push(def.name);
        }

        decs.writes = [].concat(getDefs2(sel.write, extractWriteDef2));
        decs.cogs = [].concat(getDefs2(sel.cog, extractCogDef2));
        decs.chains = [].concat(getDefs2(sel.chain, extractChainDef2));
        decs.requires = [].concat(getDefs2(sel.require, extractLibraryDef2, true));
        decs.requires = decs.requires.concat(getDefs2(sel.hoist, extractAlloyDef2));
        decs.requires = decs.requires.concat(getDefs2(sel.alloy, extractAlloyDef2));
        decs.requires = decs.requires.concat(getDefs2(sel.preload, extractPreloadDef2, true));

        return decs;
    }


    var MapItem = function() {

        this.cogZone = null;
        this.aliasZone = null;
        this.origin = null; // hosting cog if this is an alloy

        this.isAlloy = false; // hoisted cog defining behaviors or mixin style features
        this.isChain = false; // abstract cog that holds an array of cogs
        this.isPinion = false; // abstract cog with a dynamic url

        this.path = null; // local directory
        this.localSel = null;
        this.scriptData = Object.create(defaultScriptDataPrototype);
        this.url = null; // possibly relative url requested
        this.resolvedUrl = null; // fully qualified and resolved url using path
        this.state = null;
        this.name = null;
        this.parent = null;
        this.adapter = null;
        this.alloys = [];
        this.serviceMap = {};
        this.feedMap = {};
        this.aliasMap = {};
        this.dataMap = {};
        this.valveMap = null;
        this.methodMap = {};
        this.childMap = {};
        this.webServiceMap = {};
        this.itemPlace = null;
        this.uid = ++uid;
        this.destroyed = false;
        this.requirements = [];
        this.requirementsSeen = {};
        this.itemData = null;
        this.lastData = null;
        this.itemKey = null;
        this._declarationDefs = null;

        contentMap[this.uid] = this;

    };

    MapItem.prototype.findCogById = function(uid){
        return contentMap[uid];
    };

    MapItem.prototype.hash = function(arr, key, val){ // todo replace with _.indexBy for all files using it
        var h = {};

        if(typeof key === 'string') {
            var keyField = key;
            key = function (d) {
                return d[keyField];
            };
        }
        if(typeof val === 'undefined')
            val = function(d){ return d;};
        else if(typeof val === 'string') {
            var valField = val;
            val = function (d) {
                return d[valField];
            };
        }

        for(var i = 0; i < arr.length; i++){
            var d = arr[i];
            var k = key(d);
            var v = val(d);
            h[k] = v;
        }

        return h;
    };

    // todo OUCH -- no underscore references should be here -- remove
    MapItem.prototype.createParams = function(parameterMap){
        var params = {};
        var self = this;
        _.forEach(parameterMap, function(val, key){
            params[key] = self.findData(val).read();
        });
        return params;
    };

    MapItem.prototype.createValues = MapItem.prototype.mapValues = function(dataNameArray){
        var values = {};
        var self = this;
        _.forEach(dataNameArray, function(val){
            values[val] = self.findData(val).read();
        });
        return values;
    };

    MapItem.prototype.on = function(topic){
        return this.itemPlace.on(topic);
    };


    MapItem.prototype.tell = MapItem.prototype.write= function(msg, topic) {
        this.itemPlace.write(msg, topic);
    };

    MapItem.prototype.destroy = function(){
        destroyMapItem(this);
    };


    function determinePathFromFullUrl(url){
        var lastSlashPos = url.lastIndexOf("/");
        if(lastSlashPos === 0)
            return "/";
        if(lastSlashPos < url.length - 1 && lastSlashPos > 0)
            url = url.substring(0,lastSlashPos + 1);
        return url;
    }

    // take full url and get directory
    MapItem.prototype._determinePathFromFullUrl = function(url){
        var lastSlashPos = url.lastIndexOf("/");
        if(lastSlashPos === 0)
            return "/";
        if(lastSlashPos < url.length - 1 && lastSlashPos > 0)
            url = url.substring(0,lastSlashPos + 1);
        return url;
    };

    function copyProps(source, target){
        source = source || {};
        target = target || {};
        if(source){
            for(var k in source){
                target[k] = source[k];
            }
        }
        return target;
    }

    // const
    var FIRST_COG_DECLARATIONS = [

        {name: 'properties', method: 'createProp'},
        {name: 'valves', method: 'createValve'},
        {name: 'aliases', method: 'createAlias'},
        {name: 'adapters', method: 'createAdapter'},
        {name: 'dataSources', method: 'createData'},
        {name: 'commands', method: 'demandData'},
        {name: 'services', method: 'createService'},
        {name: 'feeds', method: 'createFeed'},
        {name: 'methods', method: 'createMethod'}

    ];

    MapItem.prototype._cogFirstBuildDeclarations = function(defs) {

        var self = this;

        for(var i = 0; i < FIRST_COG_DECLARATIONS.length; i++) {

            var declaration = FIRST_COG_DECLARATIONS[i];
            var list = defs[declaration.name]; // list of declarations of a certain type (data, valve, etc.)
            var method = self[declaration.method]; // constructor method

            for (var j = 0; j < list.length; j++) {
                var def = list[j];
                method.call(self, def); // instantiates and maps blueprint items of current declaration type
            }

        }

    };

    MapItem.prototype._determineAlloys = function(){

        var cog = this.parent;
        var alloys = [];

        while (cog && cog.isAlloy){
            alloys.unshift(cog);
            cog = cog.parent;
        }

        this.alloys = alloys;

    };

    MapItem.prototype._exposeAlloys = function(){

        var scriptData = this.scriptData;
        var alloys =  this.alloys;
        for(var i = 0; i < alloys.length; i++){
            var alloy = alloys[i];
            var alloyName = alloy.name;
            if(alloyName){
                if(scriptData.hasOwnProperty(alloyName))
                    this.throwError("Alloy name is property already defined: " + alloyName);
                scriptData[alloyName] = alloy.scriptData;
            }

        }

    };


    MapItem.prototype._cogBuildDeclarations = function(){

        var self = this;
        var defs = self._declarationDefs;

        if(defs)
            self._cogFirstBuildDeclarations(defs);


        self.scriptData.init();


        if(defs) {

            defs.sensors.forEach(function (def) {
                self._createSensorFromDef3(def);
            });

            defs.writes.forEach(function (def) {
                self.createWrite(def);
            });
            defs.cogs.forEach(function (def) {
                self.createCog(def);
            });
            defs.chains.forEach(function (def) {
                self.createChain(def);
            });
        }


        self.scriptData.start();

        self._declarationDefs = null;

    };


    MapItem.prototype.createLink = function(url, name, data, index, key){

        var self = this;
        var mi = new MapItem();

        mi.cogZone = self.cogZone.demandChild();
        mi.aliasZone = self.aliasZone.demandChild();
        mi.url = url;
        mi.itemData = data;
        mi.itemKey = key;
        mi.itemOrder = index;
        mi.parent = self;
        mi.scriptData.mapItem = mi;
        self.childMap[mi.uid] = mi;

        mi.placeholder = getPlaceholderDiv(); // $('<div style="display: none;"></div>');
        self.targetNode.append(mi.placeholder);

        if(self.itemType === DATA) {
            mi.createData({name: name, value: data});
        }

        mi._cogDownloadUrl(mi.url);
        return mi;

    };


    MapItem.prototype.createCog = function(def, placeholder){

        var self = this;
        var mi = new MapItem();

        mi.cogZone = def.isRoute ? self.cogZone.demandChild(def.name, def.isRoute) : self.cogZone.demandChild(def.name);
        mi.aliasZone = self.aliasZone.demandChild();

        mi.target = def.target;
        mi.action = def.action || 'append';
        mi.source = def.source;
        mi.sourceType = def.sourceType || 'prop';
        mi.item = def.item;
        mi.itemType = def.itemType;
        mi.name = def.name;
        mi.url =  def.url;
        mi.urlType = def.urlType || 'string'; // s = string, d = data, p = prop


        mi.path = (def.path) ? self._resolvePath(def.path) : null;
        mi.parent = self;
        mi.scriptData.mapItem = mi;
        self.childMap[mi.uid] = mi;

        if(def.adapter)
            mi.adapter = this._resolveValueFromType(def.adapter, def.adapterType);


        if(mi.urlType !== 'data') {

            mi.url = this._resolveValueFromType(mi.url, mi.urlType);
            if(!placeholder) {
                mi.placeholder = getPlaceholderDiv(); // $('<div style="display: none;"></div>');
                if(!mi.target){
                    console.log('error1! -- would need last from localsel??',self, self.resolvedUrl, self.localSel);
                    // was: mi.targetNode = (mi.target) ? self.scriptData[mi.target] : self.localSel.last();
                }
                mi.targetNode = (mi.target) ? self.scriptData[mi.target] : new Rei(self.localSel.last()[0]);
                mi.targetNode.append(mi.placeholder);  //[mi.action](mi.placeholder);
            } else {
                mi.placeholder = placeholder;
            }
            mi._cogDownloadUrl(mi.url);

        } else {

            mi.isPinion = true;
            mi._requirementsLoaded = true;

            if(!mi.target){
                console.log('error! -- would need last from localsel??');
                // was: mi.targetNode = (mi.target) ? self.scriptData[mi.target] : self.localSel.last();
            }

            mi.targetNode = self.scriptData[mi.target];
            mi.urlFromPlace = mi.cogZone.findData(mi.url).on('update').change().as(mi).host(mi.uid).run(mi._cogControlUrl).autorun();

        }

        return mi;

    };


    MapItem.prototype.createChain = function(def){

        var self = this;
        var mi = new MapItem();

        mi.cogZone = self.cogZone.demandChild();
        mi.aliasZone = self.aliasZone.demandChild();
        mi.isChain = true;
        mi.build = def.build;
        mi.order = def.order;
        mi.depth = def.depth;
        mi.source = def.source;
        mi.sourceType = def.sourceType;
        mi.item = def.item;
        mi.itemType = def.itemType;
        mi.target = def.target;
        mi.name = def.name;
        mi.listKey = def.key;
        mi.url =  def.url;
        mi.path = (def.path) ? self._resolvePath(def.path) : null;
        mi.parent = self;
        mi.scriptData.mapItem = mi;
        self.childMap[mi.uid] = mi;


        mi.targetNode = self.scriptData[mi.target];

        var resolvedUrl = this._resolveUrl(def.url, def.path);
        var urlPlace = bus.location("n-url:"+resolvedUrl);
        tryToDownload(resolvedUrl);
        urlPlace.on("done").as(mi).host(mi.uid).run(mi._seekListSource).once().autorun();
        return mi;

    };


    MapItem.prototype.createAlloy = function(def) {

        // url must be cached/loaded at this point
        var self = this;

        if(self.destroyed)
            return;

        var alloy = new MapItem();

        alloy.cogZone = def.isRoute ? self.cogZone.demandChild(def.name, def.isRoute) : self.cogZone.demandChild(def.name);
        alloy.aliasZone = self.aliasZone.demandChild();

        alloy.origin = self; // cog that hosts this alloy
        alloy.isAlloy = true;
        alloy.name = def.name;
        alloy.isRoute = def.isRoute;

        alloy.source = def.source;
        alloy.sourceType = def.sourceType || 'prop';
        alloy.item = def.item;
        alloy.itemType = def.itemType;

        // insert alloy between this cog and its parent
        alloy.parent = self.parent;
        alloy.parent.childMap[alloy.uid] = alloy;
        delete self.parent.childMap[self.uid];
        self.parent = alloy;
        alloy.childMap[self.uid] = self;

        self.cogZone.insertParent(alloy.cogZone);
        self.aliasZone.insertParent(alloy.aliasZone);

        alloy._cogAssignUrl(def.url);
        alloy._cogBecomeUrl();

    };

    MapItem.prototype.assignParent = function(newParent) {

        var self = this;

        var oldParent = self.parent;
        if(oldParent)
            delete oldParent.childMap[self.uid];
        self.parent = newParent;
        newParent.childMap[self.uid] = self;

    };

    MapItem.prototype._resolveSource = function() {

        if(this.isChain)
            this._chainResolveSource();
        else
            this._cogResolveSource();

    };

    MapItem.prototype._chainResolveSource = function() {

        this.sourceVal = this.parent._resolveValueFromType(this.source, this.sourceType);

        if (this.sourceType === DATA) {

            if (!this.sourceVal) {
                this.throwError('data source: ' + this.source + ' could not be resolved!');
                return;
            }

            this.sourceVal.on('update').as(this).host(this.uid).run(this._refreshListItems).autorun();

        } else {

            if(this.sourceVal === undefined){
                this.throwError('data source: ' + this.source + ' could not be resolved with static type!');
                return;
            }
            this._refreshListItems(this.sourceVal);

        }

    };

    MapItem.prototype._cogResolveSource = function() {

        if(!this.parent)
            return;

        var outerCog = this.parent;
        while (outerCog.parent && outerCog.isAlloy){
            outerCog = outerCog.parent;
        }

        this.sourceVal = (this.sourceType !== DATA && this.isAlloy) ?
            this.origin._resolveValueFromType(this.source, this.sourceType) : // resolve from the declaring cog, not the parent
            outerCog._resolveValueFromType(this.source, this.sourceType);

        this.itemVal = this._resolveValueFromType(this.item, this.itemType, true);

        if(this.itemType === DATA)
            this.itemVal = this.demandData(this.item);

        if (this.sourceType === DATA) {

            if (!this.sourceVal) {
                this.throwError('data source: ' + source + ' could not be resolved!');
                return;
            }

            if(this.itemType === DATA) {
                this.itemVal = this.demandData(this.item);
                this.sourceVal.on('update').as(this).host(this.uid).pipe(this.itemVal).autorun();

                if(typeof this.scriptData.update === 'function')
                    this.itemVal.on('update').as(this).host(this.uid).run(this.scriptData.update).autorun();
            } else {
                var d = this.sourceVal.read();
                if(this.itemType === PROP)
                    this.scriptData[this.item] = d; // todo add error check for prop collision
                else
                    this.throwError('invalid itemType: ' + this.itemType);
            }


        } else {

            if(this.itemType === DATA)
                this.itemVal.write(this.sourceVal);
            else
                this.throwError('invalid itemType: ' + this.itemType);
        }

    };


    MapItem.prototype._seekListSource = function(){

        if(this.source){
            this._resolveSource();
        } else {
            this.throwError('chain has no list source defined!');
        }

    };

    MapItem.prototype._generateKeyMapForListDisplay = function(){
        var keyMap = {};

        $.each(this.childMap, function(i, mi){
            var itemKey = mi.itemKey;
            keyMap[itemKey] = mi;
        });
        return keyMap;
    };




    MapItem.prototype._refreshListItems = function(arr){

        var url = this.url;
        var listKey = this.listKey;

        var i;

        //if(this.build === 'scratch')
        //    destroyInnerMapItems(this);

        var remnantKeyMap = this._generateKeyMapForListDisplay();
        var dataKeyMap = {};
        var listItem;


        var itemDataName = this.item;

        for(i = 0; i < arr.length; ++i){ // loop through new set of data

            var d = arr[i];
            var itemKey = (listKey) ? d[listKey] : i; // use index if key not defined
            listItem = remnantKeyMap[itemKey]; // grab existing item if key used before

            if(listItem) { // already exists
                if(this.source) {
                    var existingData = listItem.cogZone.findData(itemDataName);
                    existingData.write(d);
                }
            } else {
                listItem = this.createLink(url, itemDataName, d, i, itemKey);
            }

            dataKeyMap[itemKey] = listItem;

        }

        for(var oldKey in remnantKeyMap){
            if(!dataKeyMap[oldKey])
                (remnantKeyMap[oldKey]).destroy();
        }

    };





    MapItem.prototype._cogBecomeUrl = function(){

        var mi = this;
        if(mi.destroyed || !mi.parent || mi.parent.destroyed) return;

        var url = mi.resolvedUrl;
        var display = mi.display = cacheMap[url] && (cacheMap[url]).cloneNode(true);
        mi._declarationDefs = declarationMap[url];

        var script = scriptMap[url] || defaultScriptDataPrototype;

        mi.scriptData = Object.create(script);
        mi.scriptData.mapItem = mi;

        var scriptData = mi.scriptData;



        if(mi.isAlloy)
            mi._cogInitialize();
        else {

            var nodes = display.querySelectorAll('[id]');
            for(var i = 0; i < nodes.length; i++){
                var node = nodes[i];
                scriptData[node.id] = new Rei(node);
                node.setAttribute('id', mi.uid + '_' + node.id);
            }

            mi.localSel = $(mi.display.childNodes); //$(clonedArrayOfNodeList(htmlSel));  //htmlSel.clone();
            mi._cogRequestRequirements();
        }

    };



    MapItem.prototype._cogControlUrl = function(url){

        var mi = this;
        mi.clearContent();

        if(!url)
            return;

        var def = {
            url: url
        };

        var placeholder = getPlaceholderDiv(); // $('<div style="display: none;"></div>');
        mi.targetNode.append(placeholder);
        mi.createCog(def, placeholder);

    };


    MapItem.prototype._cogRequestRequirements = function(){

        var self = this;

        var libs = self._declarationDefs.requires;
        libs.forEach(function (def) {
            def.resolvedUrl = self._resolveUrl(def.url, def.path);
            self._cogAddRequirement(def.resolvedUrl, def.preload, def.name, def.isRoute, def);
        });

        if(self.requirements.length == 0) {
            self._cogInitialize();
        } else {
            self._cogDownloadRequirements();
        }

    };


    MapItem.prototype._cogInitialize = function(){

        var mi = this;

        if(!mi.isAlloy) {
            // mi._generateDomIds();
            mi._determineAlloys();
            mi._exposeAlloys();
        }

        mi._requirementsLoaded = true;

        if(mi.placeholder){
            mi.placeholder.replaceWith(mi.display);
            //mi.placeholder.after(mi.localSel);
            returnPlaceholderDiv(mi.placeholder);//mi.placeholder.remove();
            mi.placeholder = null;
        }

        if(mi.source)
            mi._resolveSource();

        mi._cogBuildDeclarations();

    };




    MapItem.prototype._cogRequirementReady = function(urlReady) {

        var req, i, j;
        var self = this;
        var allReady = true; // assertion to disprove
        var match = -1;
        var newReqs = [];
        var newReq;

        for(i = 0; i < self.requirements.length; i++) {
            req = self.requirements[i];
            if(req.url === urlReady && !req.ready) {
                match = i;
                req.ready = true;
                if(endsWith(urlReady,".html")){
                    var libs = declarationMap[urlReady].requires;
                    for(j = 0; j < libs.length; j++){
                        var def = libs[j];
                        def.path = def.path || determinePathFromFullUrl(urlReady);
                        var resolvedURL = self._resolveUrl(def.url, def.path);
                        if(self.requirementsSeen[resolvedURL])
                            continue;
                        newReq = createRequirement(resolvedURL, def.preload, urlReady, def.name, def.isRoute, def);
                        newReqs.push(newReq);
                        self.requirementsSeen[resolvedURL] = newReq;
                    }
                    if(newReqs.length > 0)
                        allReady = false;

                }
            }
            allReady = allReady && req.ready;
        }


        for(i = 0; i < newReqs.length; i++){
            newReq = newReqs[i];
            self.requirements.splice(match, 0, newReq); // put new requirements after last match
        }

        for(i = 0; i < newReqs.length; i++){
            newReq = newReqs[i];
            tryToDownload(newReq.url);
            newReq.place.on("done").as(self).host(self.uid).run(self._cogRequirementReady).once().autorun();
        }

        if(self._requirementsLoaded) {
            console.log('ready called but loaded set?');
            return;
        }

        if(!allReady)
            return;

        for(i = 0; i < self.requirements.length; i++){
            req = self.requirements[i];
            var url = req.url;

            if(endsWith(url,".js")) {
                if(!libraryMap[url]) { // limits script execution to once per url
                    libraryMap[url] = url;
                    var scriptText = req.place.read();
                    scriptText = wrapScript(scriptText, url);
                    addScriptElement(scriptText);
                }
            } else if(endsWith(url,".html")) {
                if(!req.preload) {
                    req.def.url = req.url || req.def.url; // todo need to redo all the filedownloads and mgmt
                    self.createAlloy(req.def);
                }
            }
        }

        // check that new requirements are downloaded -- todo optimize all this
        for(i = 0; i < self.requirements.length; i++){
            req = self.requirements[i];
            var status = req.place.peek("status");
            if(!status || !status.msg || !status.msg.done) {
                return; // requirements remain...
            }
        }

        self._cogInitialize();

    };




    function createRequirement(requirementUrl, preload, fromUrl, name, isRoute, def){
        var urlPlace = bus.location("n-url:"+requirementUrl);
        return {url: requirementUrl, fromUrl: fromUrl, place: urlPlace, preload: preload, name: name, isRoute: isRoute, def:def};
    }

    // this only adds global js lib requirements currently
    MapItem.prototype._cogAddRequirement = function(requirementUrl, preload, name, isRoute, def) {

        //console.log('add: '+ requirementUrl);
        var self = this;
        var urlPlace = bus.location("n-url:"+requirementUrl);
        var requirement = {url: requirementUrl, fromUrl: self.resolvedUrl, place: urlPlace, preload: preload, name: name, isRoute: isRoute, def: def};

        self.requirements.push(requirement);
        self.requirementsSeen[requirement.url] = requirement;

    };

    MapItem.prototype._cogDownloadRequirements = function() {

        var self = this;
        for(var i = 0; i < self.requirements.length; i++){
            var r = self.requirements[i];
            //console.log('try: '+ r.url);
            tryToDownload(r.url);
            r.place.on("done").as(self).host(self.uid).run(self._cogRequirementReady).once().autorun();
        }

    };



    function tryToDownload(url) {


        var urlPlace = bus.location("n-url:"+url);
        var status = urlPlace.peek("status");

        if(status && (status.msg.active || status.msg.done))
            return; // already downloading or successfully downloaded

        if(!status) {
            urlPlace.write({active: true, errors: 0}, "status");
        } else {
            var newStatus = {active: true, fail: false, errors: status.msg.errors};
            urlPlace.write(newStatus, "status");
        }

        var isHTML = endsWith(url, ".html");
        var suffix = "?buildNum=" + buildNum;

        //console.log("GO DOWNLOAD: " + url);

        $.ajax({url: url + suffix, dataType: "text"})
            .done(function(response, status, xhr ){

                //console.log('got file:'+url);
                urlPlace.write(response);

                if (isHTML)
                    parseResponseHTML(response, url);

                urlPlace.write({active: false, done: true}, "status");
                urlPlace.write(url, "done");


            })
            .fail(function(x,y,z){

                var status = urlPlace.peek("status");
                var newStatus = {active: false, fail: true, errors: status.msg.errors + 1};
                urlPlace.write(newStatus, "status");

            });
    }

    function endsWith(entireStr, ending){
        return (entireStr.lastIndexOf(ending) === (entireStr.length - ending.length) && entireStr.length > ending.length);
    }

    var placeholderDiv = buildPlaceholderDiv();
    var placeholderDivPool = [];

    function getPlaceholderDiv(){
        if(placeholderDivPool.length > 0)
            return placeholderDivPool.pop();
        return new Rei(placeholderDiv.cloneNode(false));
    }

    function returnPlaceholderDiv(div){
        div = (div.length) ? div[0] : div; // fix this with jquery removal
        div.remove();
        placeholderDivPool.push(div);
    }

    function buildPlaceholderDiv(){
        var fragment = document.createDocumentFragment();
        var tmp = fragment.appendChild(document.createElement("div"));
        tmp.innerHTML = '<div style="display: none;"></div>';
        return tmp.firstChild;
    }

    var rxhtmlTag = /<(?!area|br|col|embed|hr|img|input|link|meta|param)(([\w:]+)[^>]*)\/>/gi;

    function buildFragment(str) {

        var elem, tmp, i,
            fragment = document.createDocumentFragment(),
            nodes = [];

        tmp = fragment.appendChild(document.createElement("div"));

        tmp.innerHTML = str.replace(rxhtmlTag, "<$1></$2>") ;

        for(i = 0; i < tmp.childNodes.length; i++) {
            nodes.push(tmp.childNodes[i]);
        }

        tmp = fragment.firstChild;
        tmp.textContent = "";
        fragment.textContent = "";

        i = 0;
        while ((elem = nodes[i++])) {
            fragment.appendChild(elem);
        }

        return fragment;
    }

    function childNodesByName(node){

        var result = {};
        if(!node)
            return result;

        var children = node.childNodes;
        var i = 0;
        var n;

        while((n = children[i++])){
            var tag = n.localName;
            var arr = result[tag] = result[tag] || [];
            arr.push(n);
        }

        return result;
    }

    function unwrapDisplay(display){ //

        if(!display) return null;
        var fragment = document.createDocumentFragment();
        var children = display.children;
        while(children.length){
            fragment.appendChild(children[0]);
        }
        return fragment;
    }


    function clonedArrayOfChildNodes(node){

        if(!node) return [];
        var children = node.cloneNode(true).childNodes;
        var i, n, result;
        n = (i = children.length) - 1 >> 0;
        result = new Array(i);
        while (i--) {
            result[n--] = children[i];
        }
        return result;

    }

    function clonedArrayOfNodeList(list){

        if(!list) return [];
        var i, n, result;
        n = (i = list.length) - 1 >> 0;
        result = new Array(i);
        while (i--) {
            result[n--] = list[i].cloneNode(true);
        }
        return result;

    }





    function parseResponseHTML(response, url) {


        var frag = buildFragment(response);
        //console.log(frag);

        activeProcessURL = url;

        var blueSel = childNodesByName(frag.querySelector('blueprint'));//responseSel.filter("blueprint");
        var scriptSel = frag.querySelector('script'); //responseSel.filter("script");
        var htmlSel = unwrapDisplay(frag.querySelector('display'));// responseSel.filter("display").children().clone();

        var scriptText= scriptSel && scriptSel.innerHTML;

        if(scriptText) {
            scriptText = wrapScript(scriptText, url);
            try {
                addScriptElement(scriptText);
            } catch(err) {
                console.log(err);
            }
        } else {
            activeScriptData = activeScriptData || Object.create(defaultScriptDataPrototype);
        }

        if(!activeScriptData)
            throw new Error("Script Data Failure:" + url);

        if(htmlSel && htmlSel.hasChildNodes())
            cacheMap[url] = htmlSel; //.clone();
        declarationMap[url] = extractDeclarations(blueSel);

        scriptMap[url] = activeScriptData;

        parseElementIds(htmlSel, activeScriptData);

        activeScriptData = null;

    }

    function throwParseError(sel, dataType, propName){
        console.log("PARSE ERROR:"+dataType+":"+propName+":"+activeProcessURL);
    }

    function parseElementIds(display, scriptData){

        var nodes = (display && display.querySelectorAll('[id]')) || [];
        var ids = [];
        for(var i = 0; i < nodes.length; i++){
            ids.push(nodes[i].id);
        }
        //sel = $(sel);
        //var idSels = sel.find("[id]").add(sel.filter('[id]'));
        //var ids = idSels.map(function() { return this.id; }).get();

    }

    function wrapScript(scriptText, url) {
        return scriptText + "\n//# sourceURL=http://cognition" + url + "";
    }

    function addScriptElement(scriptText) {

        var scriptEle = document.createElement("script");
        scriptEle.type = "text/javascript";
        scriptEle.text = scriptText;
        // todo add window.onerror global debug system for syntax errors in injected scripts?
        document.head.appendChild(scriptEle);

        scriptEle.parentNode.removeChild(scriptEle);

    }

    MapItem.prototype._cogAssignUrl = function(url) {
        var self = this;
        self.url = url;
        var resolvedUrl = self.resolvedUrl = self._resolveUrl(url);
        self.path = self._determinePathFromFullUrl(resolvedUrl);
    };

    MapItem.prototype._cogDownloadUrl = function (url) {

        var self = this;
        self._cogAssignUrl(url);
        var urlPlace = bus.location("n-url:"+ self.resolvedUrl);
        tryToDownload(self.resolvedUrl);
        urlPlace.on("done").as(self).host(self.uid).run(self._cogBecomeUrl).once().autorun();

    };

    MapItem.prototype.clearContent = function(){
        destroyInnerMapItems(this);
        if(this.localSel){
            console.log('clear issue!!! -- expecting this to be pinion without local content');
            // this.localSel.empty();
        }
    };


    MapItem.prototype._resolvePath = function(path){

        if(path)
            path = this.findAlias(path) || path;
        else
            path = this._findPath();

        path = (path) ? this._endWithSlash(path) : "/";
        return path;

    };

    MapItem.prototype._resolveUrl = function(url, path){

        var from = this;
        url = from.findAlias(url) || url;
        path = from._resolvePath(path);
        var raw = (url.indexOf("/")===0 || url.indexOf("http://")===0 || url.indexOf("https://")===0);
        var full =  (path && !raw) ? path + url : url;
        if(full.indexOf("..")===-1)
            return full;
        return from._collapseRelativePath(full);
    };

    MapItem.prototype._collapseRelativePath = function(url){

        var parts = url.split("/");
        var remnants = [];

        while(parts.length > 0) {
            var chunk = parts.shift();
            if(chunk !== ".."){
                remnants.push(chunk);
            } else if(remnants.length > 0) {
                remnants.pop();
            }
        }
        return remnants.join("/");

    };

    MapItem.prototype._endWithSlash = function(str) {
        var lastChar = str.charAt(str.length-1);
        if(lastChar === "/") return str;
        return str + "/";
    };

    MapItem.prototype._findPath = function(){
        var item = this;
        do{
            if(item.path) // && !item.isAlloy)// && !item.library)
                return item.path;
            item = item.parent;
        } while(item);
        return undefined;
    };


    MapItem.prototype.find = function(name, thing, where, optional){

        thing = thing || 'data';
        where = where || 'first';

        var mapNames = {
            data: 'dataMap',
            feed: 'feedMap',
            service: 'serviceMap',
            alias: 'aliasMap',
            method: 'methodMap'
        };

        var map = mapNames[thing];
        return this._find(name, map, where, optional);
    };


    MapItem.prototype.createAlias = function(def){
        var url = this.aliasMap[def.name] = this._resolveUrl(def.url, def.path);
        if(def.prop)
            this.exposeProp(def.name, url);
        return url;
    };

    MapItem.prototype.createValve = function(def){

        var valveMap = this.valveMap = this.valveMap || {dataMap: null, aliasMap: null};
        var thingKey = def.thing + 'Map';
        var accessHash = valveMap[thingKey] = valveMap[thingKey] || {};
        for(var i = 0; i < def.allow.length; i++){
            var allowKey = def.allow[i];
            accessHash[allowKey] = true;
        }
        return accessHash;

    };


    MapItem.prototype.createWrite = function(def){
        var mi = this;
        var dataPlace = mi.find(def.name, def.thing, def.where);
        if(!dataPlace)
            mi.throwError("Could not write to: " + def.name + ":" + def.thing + ":" + def.where);
        dataPlace.write(def.value);
    };


    MapItem.prototype.createFeed = function(def){

        var mi = this;
        var feed = new Feed();
        feed.init(def, mi);

        return feed;

    };


    MapItem.prototype.createService = function(def){

        var mi = this;
        var service = new Service();
        service.init(def, mi);

        return service;

    };

    MapItem.prototype.createSensor = function(watch, thing, topic, where){
        thing = thing || 'data';
        topic = topic || 'update';
        where = where || 'first';
        var def = {
            watch: [watch],
            thing: thing,
            topic: topic,
            where: where
        };
        return this._createSensorFromDef3(def);
    };

    MapItem.prototype._senseInteraction = function(nodeId, eventName){
        var self = this;
        var sel = this.scriptData[nodeId];
        if (!sel) {
            self.throwError("Could not detect interaction, missing sel id: " + nodeId);
            return;
        }

        return sel.detect(eventName);

    };


    MapItem.prototype._createSensorFromDef3 = function(def){

        var mi = this;
        var dataPlace;
        var pipePlace;
        var sensor;

        if(def.find){

            var eventName = def.detect || def.topic;
            var nodeId = def.find;
            sensor = mi._senseInteraction(nodeId, eventName);

        } else {

            dataPlace = mi.cogZone.findData(def.watch, def.where, def.optional);

            if(!dataPlace && def.optional)
                return null;

            sensor = dataPlace.on(def.topic);

        }

        var context = mi.scriptData;

        sensor
            .as(context)
            .host(mi.uid);

        if(def.extract){
            sensor.extract(def.extract);
        }

        if(def.adaptPresent){
            sensor.adapt(this._resolveValueFromType(def.adapt, def.adaptType))
        }

        if(def.change)
            sensor.change();

        if (def.filter) {
            var filterMethod = context[def.filter];
            sensor.filter(filterMethod);
        }

        var multiSensor = null;
        if(def.watch.length > 1) {

            multiSensor = sensor;
            sensor = sensor.merge().on(def.topic).batch();

        } else if(def.batch) {
            sensor.batch();
        }


        if(def.transformPresent){
            sensor.transform(this._resolveValueFromType(def.transform, def.transformType))
        }

        if(def.emitPresent){
            sensor.emit(this._resolveValueFromType(def.emit, def.emitType))
        }

        if(def.retain && !def.forget)
            sensor.retain();

        if(def.group && multiSensor) {
            multiSensor.batch();
            sensor.group();
        }

        if(def.keep){
            if(multiSensor)
                multiSensor.keep(def.keep);
            else
                sensor.keep(def.keep);
        }

        if(def.need && def.need.length > 0)
            sensor.need(def.need);

        if(def.gather && def.gather.length > 0)
            sensor.gather(def.gather);

        if(def.pipe) {
            pipePlace = mi.cogZone.findData(def.pipe, def.pipeWhere, def.optional);
            if(pipePlace)
                sensor.pipe(pipePlace);
        } else if(def.toggle){
            var togglePlace = mi.cogZone.findData(def.toggle, def.pipeWhere, def.optional);
            if(togglePlace)
                sensor.run(function(){ togglePlace.toggle();});
        }

        if(def.run && !def.toggle && !def.pipe) {
            var callback = context[def.run];
            sensor.run(callback);
        }

        if(def.once)
            sensor.once();

        if(def.defer)
            sensor.defer();

        if(multiSensor)
            multiSensor.autorun();

        if(def.autorun){
            sensor.autorun();
        }

        return sensor;

    };

    MapItem.prototype.exposeProp = function(name, value){
        var mi = this;
        if(mi.scriptData[name])
            mi.throwError("Prop already defined: "+ name);
        mi.scriptData[name] = value;
    };


    MapItem.prototype.createProp = function(def){

        var mi = this;
        var prop = mi.find(def.find, def.thing, def.where, def.optional);

        if(!prop && def.optional)
            return;

        if(prop === undefined)
            mi.throwError("Could not build Prop: " + def.find + ":" + def.thing + ":" + def.where);

        if(mi.scriptData[def.name])
            mi.throwError("Prop already defined: "+ def.name);

        mi.scriptData[def.name] = prop;

        return prop;

    };

    MapItem.prototype.throwError = function(msg){
        throw new Error("MapItem: " + this.resolvedUrl + ": id: " + this.uid + ": " + msg);
    };

    MapItem.prototype.findMethod = function(name, where){
        return this._find(name, 'methodMap', where);
    };

    MapItem.prototype._find = function(name, map, where, optional) {


        if(map === 'dataMap')
            return this.cogZone.findData(name, where, optional);

        where = where || 'first'; // options: local, parent, first, outer, last

        if(where === 'local')
            return this._findLocal(name, map);
        else if(where === 'first')
            return this._findFirst(name, map);
        else if(where === 'outer')
            return this._findOuter(name, map);
        else if(where === 'last')
            return this._findLast(name, map);
        else if(where === 'parent')
            return this._findFromParent(name, map);
        else
            throw new Error('Invalid option for [where]: ' + where);
    };

    MapItem.prototype._findLocal = function(name, map) {
        return this[map][name];
    };

    MapItem.prototype._findFirst = function(name, map, fromParent) {

        var item = this;
        var checkValve = fromParent;

        do {

            if(checkValve && item.valveMap && item.valveMap[map] && !item.valveMap[map].hasOwnProperty(name))
                return undefined; // not white-listed by a valve on the cog

            checkValve = true; // not checked at the local level (valves are on the bottom of cogs)

            var result = item[map][name];
            if (item[map].hasOwnProperty(name))
                return result;

        } while (item = item.parent);

        return undefined;
    };

    MapItem.prototype._findFromParent = function(name, map) {
        var p = this.parent;
        if(!p) return undefined;
        return p._findFirst(name, map, true);
    };

    MapItem.prototype._findOuter = function(name, map) {

        var item = this;
        var found = false;
        var checkValve = false;

        do {

            if(checkValve && item.valveMap && item.valveMap[map] && !item.valveMap[map].hasOwnProperty(name))
                return undefined; // not white-listed by a valve on the cog

            checkValve = true; // not checked at the local level (valves are on the bottom of cogs)


            var result = item[map][name];
            if (item[map].hasOwnProperty(name)) {
                if (found)
                    return result;
                found = true;
            }
        } while (item = item.parent);

        return undefined;

    };

    MapItem.prototype._findLast = function(name, map) {

        var item = this;
        var result = undefined;
        var checkValve = false;

        do {

            if(checkValve && item.valveMap && item.valveMap[map] && !item.valveMap[map].hasOwnProperty(name))
                return result; // not white-listed by a valve on the cog

            checkValve = true; // not checked at the local level (valves are on the bottom of cogs)

            if (item[map].hasOwnProperty(name))
                result = item[map][name];
        } while (item = item.parent);

        return result;

    };

    MapItem.prototype.createMethod = function(def){

        var mi = this;
        var method = mi.scriptData[def.func];

        if((typeof method) !== 'function'){
            mi.throwError("Method must be a function: " + def.func);
        }

        method.originalContext = mi.scriptData;

        if(def.bound)
            method = method.bind(method.originalContext);

        return this.methodMap[def.name] = method;

    };

    MapItem.prototype.findService = function(name, where){
        return this._find(name, 'serviceMap', where);
    };

    MapItem.prototype.findFeed = function(name, where){
        return this._find(name, 'feedMap', where);
    };

    MapItem.prototype.findData = function(name, where, optional){
        return this._find(name, 'dataMap', where, optional);
    };

    MapItem.prototype.findAlias = function(name, where){
        return this._find(name, 'aliasMap', where);
    };

    MapItem.prototype.demandData = function(name){
        return this.cogZone.demandData(name);
    };


    MapItem.prototype._resolveValueFromType = function(value, type, demandIt){

        if(!type)
            return value; // assume it is what it is...

        if(type === STRING)
            return value;

        if(type === NUMBER)
            return Number(value);

        if(type === BOOLEAN)
            return (value === true || value === 'true');

        if(type === OBJECT)
            return (typeof value === 'object') ? value : null;

        if(type === DATA)
            return (demandIt) ? this.demandData(value) : this.findData(value);

        if(type === READ) {
            var d = this.findData(value);
            return function() {
                return d.read(); // todo  add error handling?
            }
        }

        if(type === FEED)
            return this.findFeed(value);

        if(type === SERVICE)
            return this.findService(value);

        var context = this.scriptData;
        if(type === PROP)
            return context[value];

        if(type === RUN)
            return this._resolveRunValue(value, context);

    };

    MapItem.prototype._resolveRunValue = function(value, context){

        var f = context[value];
        if(f && typeof f === 'function'){
            return f.call(context);
        } else {
            var method = this.findMethod(value);
            if (typeof method !== 'function') {
                this.throwError('run method not found!');
                return;
            }
            return method.call(context);
        }
    };

    MapItem.prototype.createAdapter = function(def){

        var z = this.cogZone;
        var data = z.demandData(def.name); // local data point
        var itemName = def.item || (this.parent.isChain ? this.parent.item : this.item); // todo look up why diff on chains - need alloy skip? need pinion check?
        var options = z.findData(itemName).read(); // todo add error crap if this stuff fails

        var fieldName = this._resolveValueFromType(def.field, def.fieldType);
        var externalName = options[fieldName];

        if(!externalName && def.optional) return;

        var externalData = z.findData(externalName, 'parent', def.optional); // name of data point to follow or control

        if(!externalData) return;


        if(def.control){
            data.on('*').pipe(externalData);
        } else {
            externalData.on('*').pipe(data).autorun();
        }

    };

    MapItem.prototype.createData = function(def){

        var self = this;
        var name = def.name;

        //TODO strip colons in user input, so framework can use them as reserved creations
        //if(name.indexOf(":")!=-1)
        //    self.throwError("Invalid data name: " + name);

        var value = def.value;
        var type = def.valueType;
        var inherited = false;


        if (def.inherit) {
            var ancestor = self._find(name, 'dataMap', 'first', true);
            if(ancestor && ancestor.peek()) {
                value = ancestor.read();
                inherited = true;
            }
        }

        if (!inherited)
            value = this._resolveValueFromType(value, type);

        var data = self.cogZone.demandData(name);
        //var data = self.dataMap[name] = bus.location("n-data:"+self.uid+":"+name);

        if(def.prop){
            if(self.scriptData[def.name])
                self.throwError("Property already defined: " + def.name);
            self.scriptData[def.name] = data;
        }

        if(def.name){
            data.tag(def.name);
        }

        if(def.adaptPresent){
            data.adapt(this._resolveValueFromType(def.adapt, def.adaptType))
        }

        if(def.isRoute){
            data.route();
        }

        data.initialize(value); // adapt after this?

        if(def.servicePresent || def.url) {

            var settings = def.servicePresent ? this._resolveValueFromType(def.service, def.serviceType) : {};

            if(typeof settings === 'function')
                settings = settings.call(this);

            settings.url = def.url || settings.url;
            settings.path = def.path || settings.path;
            settings.verb = def.verb || settings.verb || 'GET'; // || global default verb
            settings.params = settings.params || {};


            if(def.paramsPresent) {
                var params = this._resolveValueFromType(def.params, def.paramsType) || {};
                copyProps(params, settings.params);
            }

            var service = new WebService();
            service.init(settings, self, data);
            self.webServiceMap[data._id] = service;
            if(def.request)
                service.request();

        }

        return data;

    };

    // Arguments :
    //  verb : 'GET'|'POST'
    //  target : an optional opening target (a name, or "_blank"), defaults to "_self"
    MapItem.prototype.postToBlankWindow = function(url, data) {

        var form = document.createElement("form");
        form.action = url;
        form.method = 'POST';
        form.target = '_blank';

        if (data) {
            for (var key in data) {
                var input = document.createElement("textarea");
                input.name = key;
                input.value = typeof data[key] === "object" ? JSON.stringify(data[key]) : data[key];
                form.appendChild(input);
            }
        }

        form.style.display = 'none';
        document.body.appendChild(form);
        form.submit();
        form.parentNode.removeChild(form);

    };

    var Service = function(){

        this._mapItem = null;
        this._name = null;
        this._url = null;
        this._settings = null;
        this._defaultFeed = null;

    };

    Service.prototype.init = function(def, mi) {

        var service = mi.serviceMap[def.name] = this;

        service._mapItem = mi;
        service._name = name;

        var resolvedUrl = mi._resolveUrl(def.url, def.path);
        var settings = {};
        settings.type = (def.post) ? 'POST' : 'GET';
        settings.dataType = def.format;
        service.url(resolvedUrl).settings(settings);

        // create default feed
        var feedDef = extractDefaultFeedDefFromServiceDef(def);
        service._defaultFeed = mi.createFeed(feedDef);

        if(def.run)
            service.run(def.run);

        if(def.prop)
            mi.exposeProp(def.name, service);

        if(def.request)
            service.request();

        return service;

    };


    Service.prototype.name = function(){
        return this._name;
    };


    Service.prototype.url = function(url){
        if(arguments.length==0) return this._url;
        this._url = url;
        return this;
    };

    Service.prototype.settings = function(settings){
        if(arguments.length==0) return this._settings;
        this._settings = settings;
        return this;
    };

    Service.prototype.to = Service.prototype.data = function(dataPlace) {
        return this._defaultFeed.to(dataPlace);
    };

    Service.prototype.req = Service.prototype.request = function() {
        return this._defaultFeed.request();
    };

    Service.prototype.run = function(callbackName){
        console.log("NOT READY!!!!!");
    };

    Service.prototype.params = function(params) {
        return this._defaultFeed.params(params);
    };

    Service.prototype.parse = function(parseFunc) {
        return this._defaultFeed.parse(parseFunc);
    };

    var Rei = function(element){
        this._element = element;
    };

    Rei.prototype.detect = catbus.$.detect;

    Rei.prototype.append = function(element){
        if(element.length && element.length === 1)
            element = element[0];
        else if(element._element)
            element = element._element;
        this._element.appendChild(element);
    };

    Rei.prototype.replaceWith = function(element){
        var ref = this._element;
        ref.parentNode.replaceChild(element, ref);
    };

    Rei.prototype.focus = function(){
        this._element.focus();
    };

    Rei.prototype.val = function(value){
        if(arguments.length === 0)
            return this._element.value;

        this._element.value = value;
    };

    Rei.prototype.toggle = function(visibility){
        this._element.style.visibility = visibility ? 'visible' : 'hidden';
    };

    Rei.prototype.text = function(text){
        this._element.textContent = text;
    };

    Rei.prototype.on = function(type, handler, useCapture){
        this._element.addEventListener(type, handler, useCapture);
    };

    Rei.prototype.remove = function(){
        var element = this._element;
        if(element.parentNode){
            element.parentNode.removeChild(element);
        }
        return element;
    };

    Rei.prototype.toggleClass = function(){
       var arg_array = [];
        for(var i = 0; i < arguments.length; i++){
            arg_array.push(arguments[i]);
        }
        var class_list = this._element.classList;
        return class_list.toggle.apply(class_list, arg_array);
    };

    Rei.prototype.prop = function(nameOrOptions, value){
        var element = this._element;
        if(arguments.length === 0) return element;
        if(arguments.length === 2) {
            element[nameOrOptions] = value;
        } else {
            for(var p in nameOrOptions){
                element[p] = nameOrOptions[p];
            }
        }
    };


    Rei.prototype.css = function(nameOrOptions, value){
        var style = this._element.style;
        if(arguments.length === 0) return style;
        if(arguments.length === 2) {
            style[nameOrOptions] = value;
        } else {
            for(var p in nameOrOptions){
                style[p] = nameOrOptions[p];
            }
        }
    };

    Rei.prototype.attr = function(nameOrOptions, value){
        var attributes = this._element.attributes;
        if(arguments.length === 0) return attributes;
        if(arguments.length === 2) {
            this._element.setAttribute(nameOrOptions, value);
        } else {
            for(var p in nameOrOptions){
                this._element.setAttribute(p, nameOrOptions[p]);
            }
        }
    };

    var WebService = function() {

        this._cog = null;
        this._settings = {url: null, params: null, format: 'jsonp', verb: 'GET'};
        this._location = null;
        this._primed = false;
        this._xhr = null;
        this._timeoutId = null;

    };

    WebService.prototype.init = function(settings, cog, location){

        function overrideSettings(settings, overrides){
            var result = {};
            copyProps(settings, result);
            copyProps(overrides, result);
            return result;
        }

        this._location = location;

        location.on('settings,inline_settings').host(cog.uid).batch().merge('*').batch().group(function(msg,topic){return topic;}).retain().
            transform(function(msg){return overrideSettings(msg.settings, msg.inline_settings)}).emit('mixed_settings').pipe(location);

        location.on('mixed_settings').host(cog.uid).batch()
            .filter(function(msg){return msg && msg.request;}).transform(function(){ return {}}).emit('request').pipe(location);

        location.on('request').host(cog.uid).transform(

            function(msg){
                var request_settings = (typeof msg === 'object') ? msg : {};
                var mixed_settings = location.read('mixed_settings');
                var final_settings = overrideSettings(mixed_settings, request_settings);
                return final_settings;
            }).emit('do_request').pipe(location);

        location.on('request').batch().run(function(msg){console.log('REQUEST SETTINGS:', msg);});

        this._cog = cog;
        this.settings(settings);
        this._location.service(this);

        return this;

    };

    WebService.prototype.settings = function(settings) {


        if(arguments.length==0)
            return this._settings; // todo copy and freeze object to avoid outside mods?

        this.abort();

        var defaults = copyProps(webServiceDefaults, {});
        settings = copyProps(settings, defaults); // override defaults

        settings.resolvedUrl = this._cog._resolveUrl(settings.url, settings.path);
        this._settings = settings;

        return this;

    };

    WebService.prototype.abort = function() {

        if(this._primed) {
            clearTimeout(this._timeoutId);
            this._primed = false;
            this._timeoutId = null;
        }

        if(this.isActive()){
            this._xhr.abort();
            this._location.write(this._settings, 'abort');
        }

        return this;

    };

    WebService.prototype.isActive = function(){

        return this._xhr && this._xhr.readyState && this._xhr.readyState != 4;

    };


    WebService.prototype.params = function(params) {

        if(arguments.length==0)
            return this._settings.params; // todo copy and freeze objects to avoid outside mods?

        this.abort();

        this._settings.params = params;

        return this;
    };

    WebService.prototype.req = WebService.prototype.request = function(params){

        if(params)
            this.params(params);

        if(!this._primed){
            this._primed = true;
            this._timeoutId = setTimeout(this._runRequest.bind(this),0);
        }

        return this;

    };

    WebService.prototype._runRequest = function(){

        var self = this;
        self._primed = false;

        self.abort(); // this should not be needed, possible sanity check

        self._location.write(self._settings, 'request');
        self._location.write('busy', 'condition');

        var settings = {};

        settings.data = self._settings.params;
        settings.url = self._settings.resolvedUrl;
        settings.type = self._settings.verb || 'GET';
        settings.dataType = self._settings.format;

        self._xhr = $.ajax(settings)
            .done(function(response, status, xhr ){

                self._location.write(response);
                self._location.write(response, 'done');
                self._location.write(response, 'always');
                self._location.write(status, 'status');
                self._location.write('done', 'condition');

            })
            .fail(function(xhr, status, error){

                self._location.write(error, 'error');
                self._location.write(error, 'always');
                self._location.write(status, 'status');
                self._location.write('error', 'condition');

            })
        ;
        return self;
    };


    var Feed = function() {

        this._mapItem = null;
        this._name = null;
        this._service = null;
        this._feedPlace = null;
        this._dataPlace = null;
        this._params = null;
        this._primed = false;
        this._uid = ++uid;

    };

    Feed.prototype.init = function(def, mi){

        var feed = mi.feedMap[def.name] = this;
        var service = feed._service = mi.findService(def.service);

        var dataName = def.to || def.service;

        feed._mapItem = mi;
        feed._name = def.name;
        feed._feedPlace = bus.location("n-feed:" + mi.uid + ":"+ def.name);
        feed._dataPlace = mi.demandData(dataName);
        feed._params = null;
        feed._primed = false; // once a request is made, executed on next js frame to allow easy batching, avoid multiple calls

        if(def.prop) {
            mi.exposeProp(def.name, feed);
            if(dataName !== def.name)
                mi.exposeProp(dataName, feed._dataPlace);
        }

        if(def.request)
            feed.request();

    };

    Feed.prototype.on = function(name){
        return this._feedPlace.on(name);
    };



    Feed.prototype.to = Feed.prototype.data = function(dataPlace){
        if(arguments.length==0) return this._dataPlace;
        // todo if changing target, fire feed.detach event
        if(!dataPlace && this._name){
            // TODO is this old format and broken???
            dataPlace = this.mapItem.createData(this._name); // create data named after the feed
        }

        if((typeof dataPlace) === 'string')
            dataPlace = this.mapItem.findData(dataPlace);

        if(!dataPlace){
            console.log("INVALID DATA pointed to by feed!");
            return null;
        }
        this._dataPlace = dataPlace;
        this._dataPlace.write(this,"attach");
        return this._dataPlace;
    };

    Feed.prototype.params = function(params){
        if(arguments.length==0) return this._params;
        this._params = params;
        //this._determineParamsKey();
        return this;
    };

    Feed.prototype.parse = function(parseFunc){
        // TODO if not typeof func, error
        this._parse = parseFunc;
        return this;
    };

    function createResponseInfo(){
        return {
            response: null,
            status: null,
            xhr: null,
            error: null,
            feed: null,
            parsed: null
        };
    }

    Feed.prototype.req = Feed.prototype.request = function(){
        if(!this._primed){
            this._primed = true;
            setTimeout(this._runRequest.bind(this),0);
        }
        return this;
    };

    Feed.prototype._runRequest = function(){

        var self = this;
        self._primed = false;

        // abort any prior running request using this feed object
        var running = self._xhr && self._xhr.readyState && self._xhr.readyState != 4;
        if(running) {
            self._xhr.abort();
        }

        var info = createResponseInfo();
        info.params = self._params;
        info.feed = self;

        self._feedPlace.write(info, "request");
        if(self._dataPlace)
            self._dataPlace.write(info, "request");

        var settings = self._service._settings;
        settings.data = self._params;
        settings.url = self._service._url;

        self._xhr = $.ajax(settings)
            .done(function(response, status, xhr ){
                info.response = response;
                info.parsed = (self._parse) ? self._parse(response) : response;
                info.status = status;
                info.xhr = xhr;
                info.error = null;

                self._feedPlace.write(info, "done");
                self._feedPlace.write(info, "always");
                if(self._dataPlace)
                    self._dataPlace.write(info.parsed);

            })
            .fail(function(xhr, status, error){
                info.response = null;
                info.status = status;
                info.xhr = xhr;
                info.error = error;
                self._feedPlace.write(info, "fail");
                self._feedPlace.write(info, "always");
                if(self._dataPlace)
                    self._dataPlace.write(info, "error");
            })
        ;
        return self;
    };




})(jQuery);
