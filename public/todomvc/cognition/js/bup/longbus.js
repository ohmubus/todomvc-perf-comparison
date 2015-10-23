;(function($){

    var places = {};
    var hosts = {};
    var longbus = $.longbus = {};

    longbus._places = places;
    longbus._hosts = hosts;

    longbus._primed = false;
    longbus._queue = {defer:[], batch:[], batchAndDefer:[]};

    /*


     */
    var Club = function(topic, place) {
        this._place = place;
        this._topic = topic;
        this._interests = [];
        this._lastEnvelope = null;
    };

    Club.prototype._add = function(interest){
        this._interests.push(interest);
    };

    Club.prototype._remove = function(interest){
        var i = this._interests.indexOf(interest);
        if(i == -1) return;
        this._interests.splice(i,1);
        // TODO make some clubs persist others fade
        //if(this._interests.length == 0)
        //    this._place._destroyClub(this._topic); // remove empty club from the place
    };

    Club.prototype._tell = function(msg, from){
        this._lastEnvelope = longbus.envelope(this._place, this._topic, msg, from); // message stored enveloped before sending and transforming
        var interests = [].concat(this._interests);
        for(var i = 0; i < interests.length; i++){
            var interest = interests[i];
            interest.tell(msg, from);
        }
    };

    var Host = function(name){
        this._name = name;
        this._interestMap = {};
    };


    var Interest = function(club) {
        this._club = club;
        this._callback = null;
        this._context = null;
        this._max = null;
        this._host = null;
        this._bus = longbus;
        this._defer = false;
        this._batch = false;
        this._pipe = false;
        this._batchMsgs = null;
        this._last = null;
        this._id = ++longbus.uid;
        club._add(this);
    };

    Interest.prototype.host = function(name) {

        if(arguments.length==0) return this._host;
        if(this._host && this._host._name != name){
            delete this._host._interestMap[this._id];
            if(Object.keys(this._host._interestMap).length == 0){
                delete hosts[this._host._name];
            }
        }
        if(!name) return this; // interest removed from host
        this._host = hosts[name] || (hosts[name] = new Host(name));
        this._host._interestMap[this._id] = this;
        return this;
    };

    Interest.prototype.on = function(topic){

        var origClub  = this._club;
        var place = origClub._place;
        var origTopic = origClub._topic;

        if(arguments.length === 0) return origTopic;

        if(origClub) // changing clubs with places, leave the current one
            origClub._remove(this);
        var newClub = this._club = place._demandClub(topic);
        newClub._add(this);
        return this;
    };

    Interest.prototype.peek = Interest.prototype.inspect = function() {
        if(!this._club)
            return null;
        return this._club._lastEnvelope;
    };

    Interest.prototype.look = Interest.prototype.read = function() {
       var inspect = this.inspect();
        return (inspect) ? inspect.msg : undefined;
    };


    Interest.prototype.autorun = function() {
        var inspect = this.inspect();
        if(inspect && inspect.msg != undefined)
            this.tell(inspect.msg);
        return this;
    };

    Interest.prototype.at = function(place){

        if(arguments.length === 0) return this._club._place;
        if(typeof place === 'string'){
            var newPlace = places[place];
            if(!newPlace)
                throw new Error("Interest in unresolved place: " + place);
            place = newPlace;
        }

        if(place === this._place) return this;

        var origClub  = this._club;
        var origTopic = origClub._topic;

        if(origClub) // changing clubs with places, leave the current one
            origClub._remove(this);

        var newClub = this._club = place._demandClub(origTopic);
        newClub._add(this);
        return this;
    };

    Interest.prototype.pipe = function(place){
        this._pipe = place;
        return this;
    };


    Interest.prototype.filter = function(filterFunc){
        if(typeof filterFunc !== 'function')
            throw new Error("Interest filter must be a function");
        this._filter = filterFunc;
        return this;
    };

    Interest.prototype.run = function(callback){
        this._callback = callback;
        return this;
    };

    Interest.prototype.as = function(context){
        this._context = context;
        return this;
    };

    Interest.prototype.drop = function(){
        if(!this._club){
            return;
        }
        this.host(null);
        this._club._remove(this);
        this._club = null;
        return this;
    };

    Interest.prototype.max = function(n){
        this._max = n;
        return this;
    };

    Interest.prototype.batch = function(){
        this._batch = true;
        return this;
    };

    Interest.prototype.defer = function(){
        this._defer = true;
        return this;
    };

    Interest.prototype.once = function(){
        this._max = 1;
        return this;
    };

    Interest.prototype.change = Interest.prototype.distinct = function(){
        this._change = true;
        return this;
    };

    Interest.prototype.transform = function(transformMethod){
        this._transformMethod = transformMethod;
        return this;
    };

    Interest.prototype.tell = function(msg, from) {

        if(!this._callback && !this._pipe)
            return this; // no functions to tell

        if(this._filter && !this._filter(msg, from))
            return this;

        if (this._batch) {
            if (this._batchMsgs == null) {
                this._batchMsgs = [msg];
            } else {
                this._batchMsgs.push(msg);
            }
        }

        if (this._batch || this._defer) {
            this._bus.queue(this, msg, from);
        } else {
            this.tellNow(msg, from);
        }
    };

    Interest.prototype.tellNow = function(msg, from) {

        if(!this._club)
            return this; // dropped while batching?

        var msgContent = (this._batch) ? this._batchMsgs : msg;
        var transformedMsgContent = (this._transformMethod) ? this._transformMethod.call(this._context || this, msgContent) : msgContent;

        var envelopedMsg = longbus.envelope(this._club._place, this._club._topic, transformedMsgContent, from);

        if(this._batch) {
            this._batchMsgs = null;
        }
        this._primed = false;



        if(!this._batch && this._change && this._last && this._last.msg === envelopedMsg.msg) {
                return this;
        }
        this._last = envelopedMsg;

        if(this._pipe){
            this._pipe.tell(transformedMsgContent, 'update', envelopedMsg);
        } else {
            if(typeof (this._callback) !== 'function') return this;
            this._callback.call(this._context || this, envelopedMsg);
        }

        if(this._max > 0)
            this._max--;
        if(this._max == 0)
            this.drop();

        return this;

    };



    var Place = function(name) {
        this._name = name;
        this._clubs = {}; // by topic
        this._envelope = null;
        this._demandClub('update'); // default for data storage
    };

    Place.prototype.name = function(){
        return this._name;
    };

    Place.prototype.on = function(topic){

        topic = topic || "update";
        if(typeof topic !== 'string')
            throw new Error("Topic is not a string");

        var club = this._demandClub(topic);
        return new Interest(club);

    };

    Place.prototype._findClub = function(topic){
        return this._clubs[topic];
    };


    Place.prototype._demandClub = function(topic){
        if(typeof topic !== 'string'){
            throw new Error("Topic is not a string");
        }
        return this._findClub(topic) || (this._clubs[topic] = new Club(topic, this));
    };

    Place.prototype._destroyClub = function(topic){
        if(topic === 'update') return; // default topic not disposed
        var club = this._findClub(topic);
        if(!club || club._interests.length > 0) return null;
        delete this._clubs[topic];
    };

    Place.prototype.peek = Place.prototype.inspect = function(topic){
        if(arguments.length == 0)
            topic = 'update';
        var club = this._findClub(topic);
        if(!club)
            return undefined;
        return club._lastEnvelope;

    };

    Place.prototype.look = Place.prototype.read = function(topic) {
        if(arguments.length == 0)
            topic = 'update';
        var inspect = this.inspect(topic);
        return (inspect) ? inspect.msg : undefined;
    }

    Place.prototype.tell = Place.prototype.write  =function(msg, topic, from){

        if(arguments.length == 0){
            throw new Error("No message or topic to tell");
        }

        if(!topic)
            topic = 'update';

        this._demandClub(topic);
        for(var t in this._clubs){
            if(longbus.matchTopics(t,topic)){
                var club = this._clubs[t];
                club._tell(msg, from);
            }
        }
    };

    longbus.uid = 0;

    longbus.dropHost = function(name){
        if(!hosts[name]) return false;
        var host = hosts[name];
        var n = 0;
        for(var id in host._interestMap){
            var interest = host._interestMap[id];
            interest.drop();
            n++;
        }
    //    console.log("drop:"+name+": had: "+n);
        delete hosts[name];
    };

    longbus.at = function(name) {
        return places[name] || (places[name] = new Place(name));
    };

    longbus.matchTopics = function(subTopic, placeTopic){

        return subTopic == "*" || subTopic == placeTopic;
    };

    longbus.envelope = function(place, topic, msg, from){
        return {
            place: place,
            from: from,
            msg: msg,
            topic: topic,
            id: ++longbus.uid,
            sent: Date.now()
        }
    };


    longbus.queue = function(interest, msg, from) {

        var obj = {interest:interest,msg:msg,from:from};
        var arr;
        var q = this._queue;
        if(interest.defer) {
            if (interest.batch) {
                arr = q.batchAndDefer;
            } else {
                arr = q.defer;
            }
        } else {
            arr = q.batch;
        }
        arr.push(obj);

        if (this._primed) return;
        this._primed = true;
        setTimeout(this.emptyQueue.bind(this), 0);

    };

    longbus._processTellArray = function(arr){

        while(arr.length){
            var obj = arr.shift();
            obj.interest.tellNow(obj.msg, obj.from);
        }
    };

    // TODO use object pooling
    longbus.emptyQueue = function(){

        this._primed = false;
        var arr, obj;
        var q = this._queue;

        longbus._processTellArray(q.defer);
        longbus._processTellArray(q.batch);
        longbus._processTellArray(q.batchAndDefer);


    };

}(jQuery));