;(function($) {
    "use strict";
    var ndash = $.ndash = {};
    var bus = ndash.bus = $.longbus;
    var uid = 0;
    var rootSel = $("body");
    var htmlSel = $("html");


    var sessionTimestamp = Date.now();
    var DEBUG = true;

    var LOCAL = 'local';
    var OUTER = 'outer';
    var FIRST = 'first';
    var LAST  = 'last';


    var defaultScriptDataPrototype = {

        enter: function () {
        },
        update: function () {
        },
        exit: function () {
            if (this.mapItem)
                this.mapItem.destroy();
        },
        init: function () {
        },
        start: function () {
        },
        destroy: function () {
        }

    };

    rootSel.attr("data-n-item","root");
    $(function(){initFromDoc(htmlSel)}); // wire the entire page for n- divs


    var contentMap = {}; // layout map, built from n-item hierarchy
    var cacheMap = {}; // cache of content url loads
    var requestMap = {}; // active content url requests
    var scriptMap = {}; // prototypes


    ndash._contentMap = contentMap;
    ndash._cacheMap = cacheMap;
    ndash.masterId = 0;

    var ndashPlace  = bus.at("ndash");

    function log(postcard){
        //console.log(postcard.topic + ":" + postcard.msg);
    }

    function destroyInnerMapItems(into){
        for(var k in into.childMap){
            var mi = into.childMap[k];

            destroyMapItem(mi);
        }
       // into.children = [];
    }

    function commentScript(htmlData,url){
        var tag = "</script>";
        var debugData = "//# sourceURL=" + url + "";
        return htmlData.replace(tag,debugData+tag);
    }



    var activeScriptData = null;

    ndash.use = function(scriptData){
        activeScriptData = scriptData;
        // add default methods to this nascent prototype if not present
        $.each(defaultScriptDataPrototype, function(name, func){
            if(typeof scriptData[name] !== 'function')
                scriptData[name] = func;
        });
    };

    function initFromDoc(sel){
        var root = ndash.root = new MapItem();
        root.localSel = sel;
        root.processDeclarations();
    }

    function destroyMapItem(mapItem){

        for(var k in mapItem.childMap){
            var mi = mapItem.childMap[k];
            destroyMapItem(mi);
        }

        if(mapItem.parent){
            delete mapItem.parent.childMap[mapItem.uid];
        }

        bus.dropHost(mapItem.uid);

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
      //  if (DEBUG) //console.log("DESTROYED:"+mapItem.uid+":"+mapItem.path);
    }

    function extractProp(sel, nameOrNames, defaultValue, autoConvert){

        var val;
        autoConvert = (autoConvert === undefined) ? true : autoConvert;


        if(nameOrNames.indexOf(",")==-1) {
            val = extractOneProp(sel, nameOrNames, defaultValue, autoConvert);
            if(val == undefined)
                return defaultValue; // possibly undefined
        }

        var names = nameOrNames.split(",");
        for(var i = 0; i < names.length; i++){
            var name = names[i];
            var val = extractOneProp(sel, name, defaultValue, autoConvert);
            if(val != undefined)
                return val;
        }


        return defaultValue; // possibly undefined

    }

    function extractOneProp(sel, name, defaultValue, autoConvert){

        var str = sel.attr(name);
        if(str === undefined)
            str = sel.data(name);

        if(!autoConvert)
            return str;

        if(str === 'true')
            return true;
        if(str === 'false')
            return false;
        if(str === 'null')
            return null;

        return str;

    }


    function buildProp(sel, mi){

        var name = extractProp(sel, 'n-find,name');
        var thing = extractProp(sel, 'is', 'data');
        var become = extractProp(sel, 'local,become', name);
        var where = extractProp(sel, 'where', 'first');

        var place;
        if(thing == "data")
            place = mi.findData(name);
        else if(thing == "service")
            place = mi.findService(name);
        else if(thing == "feed")
            place = mi.findFeed(name);

        if(!place){
            throw new Error("Could not build Prop, " + thing + ":" + name + " not found");
        }

        if(mi.scriptData[become])
            throw new Error("Prop already defined: "+ become);
        mi.scriptData[become] = place;

    }

    function buildService(sel, mi){

        var name = extractProp(sel, 'n-service,name');
        var url = extractProp(sel, 'url');
        var path = extractProp(sel, 'path');
        var settings = extractProp(sel, 'settings');
        var dataPlaceName = extractProp(sel, 'to');
        var topic = extractProp(sel, 'on,topic');
        var callbackName = extractProp(sel, 'run');
        var req = extractProp(sel, 'req,request');
        var local = extractProp(sel, 'local');

        var resolvedUrl = mi._resolveUrl(url, path);

        settings = (typeof settings === 'object') ? settings : {};
        settings.dataType = settings.dataType || "jsonp";

        if(!dataPlaceName)
            dataPlaceName = name;

        var service = mi.createService(name);
        service.url(resolvedUrl).settings(settings);

        var dataPlace = mi.findData(dataPlaceName);
        if(!dataPlace)
            dataPlace = mi.createData(dataPlaceName);

        service.to(dataPlace);

        if(local){
            if(mi.scriptData[local])
                throw new Error("property already defined: "+ local);
            mi.scriptData[local] = service;
        }

        var callbackFunc = mi.scriptData[callbackName];
        if(typeof callbackFunc === 'function')
            service.run(callbackFunc);

        if(req)
            service.request();

    }


    function buildAlias(sel, mi){

        var name = extractProp(sel, 'n-alias,name');
        var path = extractProp(sel, 'path');
        var url = extractProp(sel, 'url');
        mi.createAlias(name, url, path);

    }


    function buildWrite(sel, mi){

        // TODO restore value, destroy value,
        // TODO function value options

        var name = extractProp(sel,'n-tell,name');
        var thing = extractProp(sel,'is','data');
        var where = extractProp(sel,'where','first');
        var value = extractProp(sel,'data-value,value');

        var place;
        if(thing == "data")
            place = mi._find(name, 'dataMap', where);
        else if(thing == "service")
            place = mi._find(name, 'serviceMap', where);
        else if(thing == "feed")
            place = mi._find(name, 'feedMap', where);

        if(!place){
            throw new Error("Could not build write, " + thing + ":" + name + " not found");
        }

        place.tell(value);

    }




    function buildData(sel, mi){

        var name = extractProp(sel, 'n-data,name');
        var data = mi.createData(name);
        var suck = extractProp(sel, 'suck', false);
        var inherit = extractProp(sel, 'inherit', false);
        var become = extractProp(sel, 'local,become');
        var value = extractProp(sel, 'value');
        var prop = extractProp(sel, 'prop,property', false);

        if(prop){
            become = become || name;
        } else {
            //become = null; TODO -- bring this back once 'prop' added throughout project
        }

        if(suck){
            var func = mi.scriptData[suck];
            if(typeof func == 'function') {
                value = func.call(mi.scriptData);
            } else {
                if(mi.scriptData[suck]===undefined){
                    throw new Error("Suck is not defined!");
                }
                value = mi.scriptData[suck];
            }
        } else if(inherit) {
            var ancestor = mi._find(name, 'dataMap', 'outer');
            if(ancestor && ancestor.peek())
                value = ancestor.peek().msg;
        }

        if(become){
            if(mi.scriptData[become])
                throw new Error("property already defined: "+ become);
            mi.scriptData[become] = data;
        }
        // TODO should we silence if data == undefined?
        data.tell(value);
    }



    function buildFeed(sel, mi){

        var local = extractProp(sel,'local');
        var serviceName = extractProp(sel, 'service');
        var name = extractProp(sel, 'n-feed,name', serviceName);
        var req = extractProp(sel, 'req,request');

        var service = mi.findService(serviceName);
        var feed = mi.createFeed(name, service);
        var dataPlaceName = extractProp(sel, 'to', name);
        var dataPlace = mi.demandData(dataPlaceName); // data lives on the feed level if autocreated

        if(local){
            if(mi.scriptData[local])
                throw new Error("property already defined: "+ local);
            mi.scriptData[local] = feed;
        }




        feed.to(dataPlace);

        if(req)
            feed.request();

    }

    function buildMethod(sel, mi){

        var name = extractProp(sel,'n-method,name');
        var func = mi.scriptData[name];
        mi.createMethod(name,func);

    }


    function buildInterest(sel, mi, tag){

        var pipe = extractProp(sel, 'pipe', false);
        var run = extractProp(sel, 'run');

        if(tag && !run && !pipe) // data, feed, or service tag lacks interest
            return;

        var names = extractProp(sel, 'n-interest,name,in');
        if(!names){
            console.log("def:" + sel.get(0).outerHTML);
            return;
        }
        var list = names.split(",");

        var thing = tag || extractProp(sel, 'is', "data");
        var topic = extractProp(sel, 'on,topic', 'update');
        var once = extractProp(sel, 'once', false);
        var autorun = extractProp(sel, 'auto,autorun', false);
        var batch = extractProp(sel, 'batch', false);
        var local = extractProp(sel, 'local,become', false);
        var where = (tag) ? "local" : extractProp(sel, 'where', 'first');
        var pipeWhere = extractProp(sel, 'pipe-where', 'first');

        var change = extractProp(sel, 'change,distinct', false);
        var transform = extractProp(sel, 'transform', false);

        var name;
        var place;
        var pipePlace;
        var transformMethod;
        var callback;

        // TODO don't autocreate, make them declare it
        if(pipe)
            pipePlace = mi._find(pipe, 'dataMap', pipeWhere);

        for(var i=0; i < list.length; i++) {

            name = list[i];

            if (thing == "data")
                    place = mi.findData(name);
            else if (thing == "service")
                place = mi.findService(name);
            else if (thing == "feed")
                place = mi.findFeed(name);

            if (!place) {
                throw new Error("Could not build interest, " + thing + ":" + name + " not found");
            }

            var interest = place.on(topic).as(mi.scriptData).host(mi.uid);

            if(pipe)
                interest.pipe(pipePlace);

            if(run) {
                callback = mi.scriptData[run];
                interest.run(callback);
            }

            if (transform) {
                transformMethod = mi.scriptData[transform];
                // TODO move this error into bus code
                if ((typeof transformMethod) !== 'function') {
                    throw new Error("Transform method " + transform + " not found");
                }
                interest.transform(transformMethod);
            }

            if(once)
                interest.once();

            if(change)
                interest.change();

            if(batch)
                interest.batch();

            if(autorun)
                interest.autorun();

        }

    }




    var MapItem = function() {

        this.path = null; // local directory
        this.localSel = null;
        this.scriptData = Object.create(defaultScriptDataPrototype);
        this.url = null; // possibly relative url requested
        this.resolvedUrl = null; // fully qualified and resolved url using path
        this.urlFrom = null;
        this.state = null;
        this.name = null;
        this.parent = null;
        this.serviceMap = {};
        this.feedMap = {};
        this.aliasMap = {};
        this.dataMap = {};
        this.methodMap = {};
        this.childMap = {};
        this.config = {};
        this.itemPlace = null;
        this.uid = ++uid;
        this.destroyed = false;
        this.requirements = [];
        this.itemData = null;
        this.lastData = null;
        this.itemKey = null;

    };

    MapItem.prototype.createParams = function(parameterMap){
        var params = {};
        var self = this;
        _.forEach(parameterMap, function(val, key){
            params[key] = self.findData(val).peek().msg;
        });
        return params;
    };

    MapItem.prototype.createValues = MapItem.prototype.mapValues = function(dataNameArray){
        var values = {};
        var self = this;
        _.forEach(dataNameArray, function(val){
            values[val] = self.findData(val).peek().msg;
        });
        return values;
    };

    MapItem.prototype.on = function(topic){
        return this.itemPlace.on(topic);
    };


    MapItem.prototype.tell = MapItem.prototype.write= function(msg, topic) {
        this.itemPlace.tell(msg, topic);
    };

    MapItem.prototype.destroy = function(){
        destroyMapItem(this);
    };


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
        for(var k in source){
            target[k] = source[k];
        }
        return target;
    }

    MapItem.prototype.processDeclarations = function(){

        var self = this;
        self.buildDeclarations();

        var items = self.localSel.find("[data-n-item],[item],[data-map-item]");
        items.each(function(){
            self.createChildFromSel($(this));
        });

        var lists = self.localSel.find("[data-n-list],[list],[data-map-list]");
        lists.each(function(){
            self.createListFromSel($(this));
        });


    };

    MapItem.prototype.buildDeclarations = function(){

        var self = this;
        var ls = self.localSel;
        var props = ls.data();
        var k;

        if(props == undefined)
            console.log("grr");
        copyProps(props, self.config);

        var aliases = ls.find("[data-n-alias],alias");
        aliases.each(function(){
            buildAlias($(this),self);
        });

        // expose data/service/feed references locally
        var properties = ls.find("[data-n-find],find,prop");
        properties.each(function(){
            buildProp($(this),self);
        });

        // create named data sources
        var dataSources = ls.find("[data-n-data],data");
        dataSources.each(function(){
            buildData($(this),self);
        });

        // create services
        var services = ls.find("[data-n-service],service");
        services.each(function(){
            buildService($(this),self);
        });

        // create feeds
        var feeds = ls.find("[data-n-feed],feed");
        feeds.each(function(){
            buildFeed($(this),self);
        });


        // create methods
        var methods = ls.find("[data-n-method],method");
        methods.each(function(){
            buildMethod($(this),self);
        });

        var initCallback = self.scriptData.init;

        if(typeof initCallback === "function") {
            initCallback.call(self.scriptData);
        }

        // create interests after init is run so autoruns don't explode on an empty view
        var interests = ls.find("[data-n-interest],interest");
        interests.each(function(){
            buildInterest($(this),self);
        });

        dataSources.each(function(){
            buildInterest($(this),self,"data");
        });

        //feeds.each(function(){
        //    buildInterest($(this),self,"feed");
        //});

        //services.each(function(){
        //    buildInterest($(this),self,"service");
        //});

        var writes = ls.find("[data-n-tell],tell,write");
        writes.each(function(){
            buildWrite($(this),self);
        });


        var startCallback = self.scriptData.start;

        if(typeof startCallback === "function") {
            startCallback.call(self.scriptData);
        }


        var visFrom = props['visFrom'];

        if(visFrom){
            self.visFrom = visFrom;
            self.visFromPlace = self.findData(visFrom).on('update').change().as(self).host(self.uid).run(self._visFromHandler).autorun();
        }

    };

    MapItem.prototype.createChildFromSel = function(sel){

        var self = this;
        var props = sel.data();
        var path = extractProp(sel, "path");
        var name = extractProp(sel, "n-item,map-item,name");
        var url = extractProp(sel, "url");
        var urlFrom = extractProp(sel, "url-from");
        var visFrom = extractProp(sel, "vis-from,visibility-from");

        var mi = new MapItem();

        mi.root = mi.localSel = sel;
        mi.name = name;
        mi.path = (path) ? this._resolvePath(path) : null;
        mi.config = copyProps(props, {});
        //console.log("config of :"+name);
        //console.log(mi.config);
        mi.parent = self;
        mi.scriptData.mapItem = mi;
        self.childMap[mi.uid] = mi;

        if(url) {
            mi.url = url;
            mi.insertContent(url);
        } else if(urlFrom) {
            mi.urlFrom = urlFrom;
            mi.urlFromPlace = mi.findData(urlFrom).on().distinct().as(mi).host(mi.uid).run(mi._urlFromHandler).autorun();
        }

        if(visFrom){
            mi.visFrom = visFrom;
            mi.visFromPlace = mi.findData(visFrom).on().distinct().as(mi).host(mi.uid).run(mi._visFromHandler).autorun();
        }


    };

    MapItem.prototype.createListFromSel = function(sel){

        var self = this;
        var props = sel.data();
        var path = extractProp(sel, "path");
        var name = extractProp(sel, "data-n-list,name");
        var url = extractProp(sel, "url");
        var source = extractProp(sel, 'source');
        var key = extractProp(sel, 'key');
        var visFrom = extractProp(sel, "vis-from");

        var mi = new MapItem();

        mi.root = mi.localSel = sel;
        mi.name = name;
        mi.path = (path) ? this._resolvePath(path) : null;
        mi.url = url;
        mi.config = copyProps(props, {});
        mi.parent = self;

        mi.createConfig("source",source);
        mi.createConfig("key", key);
        mi.createConfig("itemUrl", url);

        var resolvedUrl = this._resolveUrl(url, path);
        var urlPlace = bus.at("n-url:"+resolvedUrl);
        tryToDownload(resolvedUrl);
        urlPlace.on("done").as(mi).host(mi.uid).run(mi._seekListSource).once().autorun();

        mi.scriptData.mapItem = mi;
        self.childMap[mi.uid] = mi;

        if(visFrom){
            mi.visFrom = visFrom;
            mi.visFromPlace = mi.findData(visFrom).on().distinct().as(mi).host(mi.uid).run(mi._visFromHandler).autorun();
        }

    };

    MapItem.prototype.createLibraryFromURL = function(url) {

        // must be (ie assumed) cached at this point
        var self = this;

        if(self.destroyed)
            return;

        var lib = new MapItem();

        lib.library = url;

        lib.parent = self.parent;
        lib.parent.childMap[lib.uid] = lib;
        delete self.parent.childMap[self.uid];
        self.parent = lib;
        lib.childMap[self.uid] = self;

        lib._constructFromURL({msg:url});

    };

    MapItem.prototype.createChildFromURL = function(url, config) {

        var self = this;

        if(self.destroyed)
            return;

        var mi = new MapItem();

        if(!config) config = {};

        mi.name = config.name || null;
        mi.url = url;
        mi.config = copyProps(config, {});
        mi.parent = self;
        self.childMap[mi.uid] = mi;

        var resolvedUrl = mi.resolvedUrl = this._resolveUrl(url);
        mi.path = this._determinePathFromFullUrl(resolvedUrl);
        var urlPlace = bus.at("n-url:"+resolvedUrl);
        tryToDownload(resolvedUrl);
        urlPlace.on("done").as(mi).host(mi.uid).run(mi._constructFromURL).once().autorun();

        return mi;

    };

    MapItem.prototype._seekListSource = function(){

        var source = this.findConfig("source");
        this.findData(source).on().as(this).host(this.uid).run(this._refreshListItems).autorun();

    };

    MapItem.prototype._generateKeyMapForListDisplay = function(){
        var keyMap = {};

        $.each(this.childMap, function(i, mi){
            var itemKey = mi.itemKey;
            keyMap[itemKey] = mi;
        });
        return keyMap;
    };

    MapItem.prototype._generateChildArray = function(){
        return $.map(this.childMap, function(mi){ return mi;});
    };

    MapItem.prototype._refreshListItems = function(data){

        var arr = data.msg;
        var url = this.url;
        var listKey = this.listKey;

        var i;

        var origItemMap = this._generateKeyMapForListDisplay();
        var dataItemMap = {};
        var listItem;

        var exiting = [];
        var updating = [];
        var entering = [];

        for(i = 0; i < arr.length; ++i){ // loop through new set of data

            var d = arr[i];
            var itemKey = (listKey) ? d[listKey] : i; // use index if key not defined
            listItem = origItemMap[itemKey]; // grab existing item if key used before

            if(listItem) {// already exists
                var lastData = listItem.itemData;
                listItem.itemData = d;
                listItem.lastData = lastData;
                updating.push(listItem);
            } else {
                listItem = this.createChildFromURL(url);
                listItem.itemData = d;
                listItem.itemKey = itemKey;
                entering.push(listItem);
            }

            dataItemMap[itemKey] = listItem;

        }

        $.each(origItemMap, function(oldKey, listItem){
            if(!dataItemMap[oldKey])
                exiting.push(listItem);
        });

        this._appendList(entering, updating, exiting);

      //  this._recycleList(entering, updating, exiting);

    };


    MapItem.prototype._appendList = function(entering, updating, exiting, sortFunc){

        var resulting = [].concat(updating).concat(entering);

        if(typeof sortFunc === 'function'){
            var everything = resulting.concat(exiting); // in case they transition out
            var sorted = everything.sort(sortFunc);
            var sortedSels = $.map(sorted, function(mi){
                return mi.localSel;
            });
            this.localSel.append(sortedSels);
        }

        $.each(entering, function(i, listItem){
            listItem.scriptData.enter.call(listItem.scriptData);
        });

        $.each(resulting, function(i, listItem){
            listItem.scriptData.update.call(listItem.scriptData);
        });

        $.each(exiting, function(i, listItem){
            listItem.scriptData.exit.call(listItem.scriptData);
        });


    };




    MapItem.prototype._constructFromURL = function(data){

        var url = data.msg;
        var htmlSel = cacheMap[url];
        var script = scriptMap[url] || defaultScriptDataPrototype;
        var sel = htmlSel.clone();

        this.localSel = sel;
        this.scriptData = Object.create(script);
        this.scriptData.mapItem = this;

        this._requestRequirements();

    };

    MapItem.prototype._requestRequirements = function(){

        var self = this;
        var ls = self.localSel;

        var libs = ls.find("[data-n-lib],library");
        libs.each(function(){
            var url = extractProp($(this),'n-lib,url');
            var path = extractProp($(this),'path');
            self._addRequirement(url, path);
        });

        if(this.requirements.length == 0)
            this._initialize();
    };

    MapItem.prototype._initialize = function(){

        // append dom to first non-library parent
        if(!this.library) {
            var target = this.parent;
            while(target){
                if(!target.library){
                    this._generateDomIds();
                    target.localSel.append(this.localSel);
                    break;
                }
                target = target.parent;
            }
            //this.parent.localSel.append(this.localSel);
        }
        this.processDeclarations();
    };

    MapItem.prototype._generateDomIds = function(){
        var scriptData = this.scriptData;
        var ids = scriptData._ids;
        if(!ids || !ids.length) return;
        var sel = this.localSel;
        for(var i = 0; i < ids.length; i++){
            var id = ids[i];
            var el = sel.find("#"+id);
            if(!el.data("preserveId"))
                el.attr("id",this.uid+"_"+id);
            var camelId = id.replace(/-([a-z])/g, function (g) { return g[1].toUpperCase(); });
            scriptData[camelId] = el;
            //scriptData[id] = el.get(0);
        }
       // console.log("dommin");
       // console.log(scriptData);
    };

    MapItem.prototype._requirementReady = function(data) {

        var req, i;
        var self = this;

        // check that all requirements are downloaded
        for(i=0; i<this.requirements.length;i++){
            req = this.requirements[i];
            var status = req.place.peek("status");
            if(!status.msg.done) {
                 return; // requirements remain...
            }
        }

        // insert javascript libs in order -- TODO allow order based on config?

        for(i=0; i<this.requirements.length;i++){
            req = this.requirements[i];
            var url = req.url;

            if(endsWith(url,".js")){
                var scriptText = req.place.peek().msg;
                addScriptElement(scriptText);
            } else if(endsWith(url,".html")) {
                self.createLibraryFromURL(url);
                // force only alias/data
            }
        }

        // all requirements have been met
        // mapItem is GO!
        this._initialize();

    };

    MapItem.prototype._addRequirement = function(url, path) {

        var self = this;
        var resolvedURL = this._resolveUrl(url, path);

        var urlPlace = bus.at("n-url:"+resolvedURL);

        this.requirements.push({url: resolvedURL, place: urlPlace});

        tryToDownload(resolvedURL);
        urlPlace.on("done").as(self).host(self.uid).run(self._requirementReady).once().autorun();

    };


    function tryToDownload(url) {

        var urlPlace = bus.at("n-url:"+url);
        var status = urlPlace.peek("status");

        if(status && (status.msg.active || status.msg.done))
            return; // already downloading or successfully downloaded

        if(!status) {
            urlPlace.tell({active: true, errors: 0}, "status");
        } else {
            var newStatus = {active: true, fail: false, errors: status.errors};
            urlPlace.tell(newStatus, "status");
        }

        var isHTML = endsWith(url, ".html");
        var suffix = (isHTML) ? "?sessionTimestamp=" + sessionTimestamp : "";

        $.ajax({url: url + suffix, dataType: "text"})
            .done(function(response, status, xhr ){

               urlPlace.tell(response);

               if (isHTML)
                    parseResponseHTML(response, url);

                urlPlace.tell({active: false, done: true}, "status");
                urlPlace.tell(url,"done");


            })
            .fail(function(x,y,z){

                var status = urlPlace.peek("status");
                var newStatus = {active: false, fail: true, errors: status.errors + 1};
                urlPlace.tell(newStatus, "status");

            });
    }

    function endsWith(entireStr, ending){
        return (entireStr.lastIndexOf(ending) === (entireStr.length - ending.length) && entireStr.length > ending.length);
    }

    function parseResponseHTML(response, url) {


        var htmlSel = $(response);
        var scriptSel = htmlSel.filter("script");
        htmlSel = htmlSel.filter(":not(script)");

        var scriptText;
        if(scriptSel.length > 0)
            scriptText = scriptSel[0].innerHTML;

        if(scriptText) {
            scriptText = wrapScript(scriptText, url);
            addScriptElement(scriptText);
        } else {
            activeScriptData = activeScriptData || defaultScriptDataPrototype;
        }

        if(!activeScriptData)
            throw new Error("Script Data Failure");

        cacheMap[url] = htmlSel;
        scriptMap[url] = activeScriptData;

        parseElementIds(htmlSel, activeScriptData);

        activeScriptData = null;

    }

    function parseElementIds(sel, scriptData){
        // TODO store these in the mapitem function def creator later
        // when map items runs as function list not parse build
        var ids = sel.find("[id]").map(function() { return this.id; }).get();
        scriptData._ids = ids;
        //console.log(ids.length);
        //console.log(ids);
    }

    function wrapScript(scriptText, url) {

        var wrapped =
           // "(function() { 'use strict'; " + scriptText + " } " +
           // " )()" +
                scriptText + "\n//# sourceURL=" + url + "";
        return wrapped;
    }

    function addScriptElement(scriptText) {

        var scriptEle = document.createElement("script");
        scriptEle.type = "text/javascript";
        scriptEle.text = scriptText;
     //   console.log("script!!!!");
     //   console.log(scriptText);
        document.head.appendChild(scriptEle); // runs ndash.use(some_object) if html based;
        scriptEle.parentNode.removeChild(scriptEle);

    }

    MapItem.prototype.insertContent = function(url, name, config){
         this.createChildFromURL(url, config);
    };

    MapItem.prototype._urlFromHandler = function (data) {
        if(!data)
            return;
        var url = this.url = data.msg;
        this.replaceContent(url);
    };

    MapItem.prototype._visFromHandler = function (data) {
        if(!data || !data.msg) return;
        var visName = data.msg;
        this.localSel.toggle(visName == this.name);
    };

    MapItem.prototype.clearContent = function(){
        destroyInnerMapItems(this);
        this.localSel.empty();
    };

    MapItem.prototype.replaceContent = function(url, name, config){
        this.clearContent();
        if(url)
            this.insertContent(url, name, config);
    };

    /*
    MapItem.prototype.findAlias = function(name){

        var alias = this.aliasMap[name];
        var item = this;

        while(!alias && item.parent) {
            item = item.parent;
            alias = item.aliasMap[name];
        }

        return alias;
    };
*/

    MapItem.prototype._resolvePath = function(path){

        if(path)
            path = this.findAlias(path) || path;
        else
            path = this._findPath();

        path = (path) ? this._endWithSlash(path) : "/";
        return path;

    };


    MapItem.prototype._resolveUrl = function(url, path){
        url = this.findAlias(url) || url;
        path = this._resolvePath(path);
        var raw = (url.indexOf("/")===0 || url.indexOf("http://")===0 || url.indexOf("https://")===0);
        var full =  (path && !raw) ? path + url : url;
        if(full.indexOf("..")===-1)
            return full;
        return this._collapseRelativePath(full);
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
            if(item.path)// && !item.library)
                return item.path;
            item = item.parent;
        } while(item);
        return undefined;
    };


    MapItem.prototype.createAlias = function(name, url, path){
        this.aliasMap[name] = this._resolveUrl(url, path);
    };

    /*
    MapItem.prototype.findService = function(name, outerScope){
        var service = this.serviceMap[name];
        if(!outerScope && service)
            return service;
        service = null;
        var item = this;

        while(!service && item.parent) {
            item = item.parent;
            service = item.serviceMap[name];
        }
        return service;
    };

/*
    MapItem.prototype.findFeed = function(name, outerScope){
        var feed = this.feedMap[name];
        if(!outerScope && feed)
            return feed;
        feed = null;
        var item = this;

        while(!feed && item.parent) {
            item = item.parent;
            feed = item.feedMap[name];
        }
        return feed;
    };
*/

    MapItem.prototype.createFeed = function(name, service){
        return this.feedMap[name] = new Feed(name, service, this);
    };

    MapItem.prototype.createService = function(name){
        return this.serviceMap[name] = new Service(name, this);
    };


    MapItem.prototype.findLocalMethod = function(name){
        return this.methodMap[name];
    };

    MapItem.prototype.findOuterMethod = function(name){
        var item = this;

        while(item = item.parent) {
            if(item.methodMap.hasOwnProperty(name))
                return item.methodMap[name];
        }
        return undefined;
    };

    MapItem.prototype.findMethod = function(name){

        if(this.methodMap.hasOwnProperty(name))
            return this.methodMap[name].bind(this.scriptData);

        var item = this;

        while(item = item.parent) {
            if(item.methodMap.hasOwnProperty(name))
                return item.methodMap[name].bind(item.scriptData);
        }
        return undefined;
    };



    MapItem.prototype._find = function(name, map, where) {

        where = where || FIRST; // options: local, first, outer, last

        if(where === LOCAL)
            return this._findLocal(name, map);
        else if(where === FIRST)
            return this._findFirst(name, map);
        else if(where === OUTER)
            return this._findOuter(name, map);
        else if(where === LAST)
            return this._findLast(name, map);
        else
            throw new Error('Invalid option for [where]: ' + where);
    };

    MapItem.prototype._findLocal = function(name, map) {
        return this[map][name];
    };

    MapItem.prototype._findFirst = function(name, map) {

        var item = this;
        do {
            var result = item[map][name];
            if (result)
                return result;
        } while (item = item.parent);

        return undefined;
    };


    MapItem.prototype._findOuter = function(name, map) {

        var item = this;
        var found = false;

        do {
            var result = item[map][name];
            if (result) {
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
        do {
            result = item[map][name] || result;
        } while (item = item.parent);

        return result;

    };

    MapItem.prototype.createMethod = function(name, method){
        if(arguments.length != 2) {
            throw new Error("Invalid parameter(s): Create method requires name [string] and method [function]");
        }
        if(name.indexOf(":")!=-1 || name.indexOf(".")!=-1) {
            throw new Error("Invalid method name");
        }
        if((typeof method) !== 'function'){
            throw new Error("Method must be a function");
        }
        return this.methodMap[name] = method;
    };

/*
    MapItem.prototype.findLocalData = function(name){
        return this.dataMap[name];
    };

    MapItem.prototype.findOuterData = function(name){
        var item = this;

        while(item = item.parent) {
            if(item.dataMap.hasOwnProperty(name))
                return item.dataMap[name];
        }
        return undefined;
    };

    MapItem.prototype.findData = function(name){

        if(this.dataMap.hasOwnProperty(name))
            return this.dataMap[name];

        var item = this;

        while(item = item.parent) {
            if(item.dataMap.hasOwnProperty(name))
                return item.dataMap[name];
        }
        return undefined;
    };
*/

    MapItem.prototype.findService = function(name, where){
        return this._find(name, 'serviceMap', where);
    };

    MapItem.prototype.findFeed = function(name, where){
        return this._find(name, 'feedMap', where);
    };

    MapItem.prototype.findData = function(name, where){
        return this._find(name, 'dataMap', where);
    };

    MapItem.prototype.findConfig = function(name, where){
        return this._find(name, 'config', where);
    };

    MapItem.prototype.findAlias = function(name, where){
        return this._find(name, 'aliasMap', where);
    };

    //MapItem.prototype.findMethod = function(name, where, context){
    //    var method = this._find(name, 'methodMap', where);
    //    if(typeof method !== 'function')
    //        throw new Error('Method is not defined');
    //    context = context || this.
    //};

    MapItem.prototype.demandData = function(name){
        return this.findData(name, LOCAL) || this.createData(name);
    };

    MapItem.prototype.createConfig = function(name, value){
        this.config[name] = value;
    };
/*
    MapItem.prototype.findConfig = function(name){
        return (this.findLocalConfig(name) != undefined) ? this.findLocalConfig(name) : this.findOuterConfig(name);
    };


    MapItem.prototype.findLocalConfig = function(name){
        return this.config[name];
    };

    MapItem.prototype.findOuterConfig = function(name){
        var item = this;

        while(item = item.parent) {
            if(item.config.hasOwnProperty(name))
                return item.config[name];
        }
        return undefined;
    };

*/

    MapItem.prototype.createData = function(name){
        if(name.indexOf(":")!=-1 || name.indexOf(".")!=-1) {
            console.log("Invalid data name: "+name);
            return null;
        }
        return this.dataMap[name] = bus.at("n-data:"+this.uid+":"+name);
    };

    var Service = function(name, mi){
        this._name = name;
        this._url = null;
        this._settings = {};
        this._mapItem = mi;
        this._defaultFeed = mi.createFeed(name, this);
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

    var Feed = function(name, service, mapItem) {

        this._name = name;
        this._service = service;
        this._mapItem = mapItem;
        this._feedPlace = bus.at("n-feed:" + mapItem.uid + ":"+ name);
        this._dataPlace = null;
        this._params = null;
        this._parse = null;
        this._primed = false; // once a request is made, executed on next js frame to allow easy batching, avoid multiple calls

        this._uid = ++uid;
    };

    Feed.prototype.on = function(name){
        return this._feedPlace.on(name);
    };

    // TODO feed cache with array and hashmap to make history size

    Feed.prototype.to = Feed.prototype.data = function(dataPlace){
        if(arguments.length==0) return this._dataPlace;
        // todo if changing target, fire feed.detach event
        if(!dataPlace && this._name){
            dataPlace = this.mapItem.createData(this._name); // create data named after the feed
        }

        if((typeof dataPlace) === 'string')
            dataPlace = this.mapItem.findData(dataPlace);

        if(!dataPlace){
            console.log("INVALID DATA pointed to by feed!");
            return null;
        }
        this._dataPlace = dataPlace;
        this._dataPlace.tell(this,"attach");
        return this._dataPlace;
    };

/*
    // key for feed history based on request params - still TODO
    Feed.prototype._determineParamsKey = function(){

        var arr = [];
        for(var p in this._params){
            arr.push(p);
        }
        arr.sort();
        var result = [];
        for(var i=0; i<arr.length; i++){
            var k = arr[i];
            result.push(k);
            var v = this._params[k];
            result.push(v);
        }
        this._paramsKey = this._name + "::" + JSON.stringify(result);
    };

*/

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

        self._feedPlace.tell(info, "request");
        if(self._dataPlace)
            self._dataPlace.tell(info, "request");

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

                self._feedPlace.tell(info, "done");
                self._feedPlace.tell(info, "always");
                if(self._dataPlace)
                    self._dataPlace.tell(info.parsed);

            })
            .fail(function(xhr, status, error){
                info.response = null;
                info.status = status;
                info.xhr = xhr;
                info.error = error;
                self._feedPlace.tell(info, "fail");
                self._feedPlace.tell(info, "always");
                if(self._dataPlace)
                    self._dataPlace.tell(info, "error");
            })
        ;
        return self;
    };



})(jQuery);
