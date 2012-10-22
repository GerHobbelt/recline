// # Recline Backbone Models
this.recline = this.recline || {};
this.recline.Model = this.recline.Model || {};

(function($, my) {

// ## <a id="dataset">Dataset</a>
my.Dataset = Backbone.Model.extend({
  constructor: function Dataset() {
    Backbone.Model.prototype.constructor.apply(this, arguments);
  },

  // ### initialize
  initialize: function() {
    _.bindAll(this, 'query', 'selection');
    this.backend = null;
    if (this.get('backend')) {
      this.backend = this._backendFromString(this.get('backend'));
    } else { // try to guess backend ...
      if (this.get('records')) {
        this.backend = recline.Backend.Memory;
      }
    }
    this.fields = new my.FieldList();
    this.records = new my.RecordList();
    this._changes = {
      deletes: [],
      updates: [],
      creates: []
    };
    this.facets = new my.FacetList();
    this.recordCount = null;
    this.queryState = new my.Query();
    this.queryState.bind('change', this.query);
    this.queryState.bind('facet:add', this.query);
    this.queryState.bind('selection:change', this.selection);
    // store is what we query and save against
    // store will either be the backend or be a memory store if Backend fetch
    // tells us to use memory store
    this._store = this.backend;
    if (this.backend == recline.Backend.Memory) {
      this.fetch();
    }
  },

  // ### fetch
  //
  // Retrieve dataset and (some) records from the backend.
  fetch: function() {
    var self = this;
    var dfd = $.Deferred();

    if (this.backend !== recline.Backend.Memory) {
      this.backend.fetch(this.toJSON())
        .done(handleResults)
        .fail(function(arguments) {
          console.log("Fail in fetching data");
          dfd.reject(arguments);
        });
    } else {
      // special case where we have been given data directly
      handleResults({
        records: this.get('records'),
        fields: this.get('fields'),
        useMemoryStore: true
      });
    }

    function handleResults(results) {
      var out = self._normalizeRecordsAndFields(results.records, results.fields);
      if (results.useMemoryStore) {
          self._store = new recline.Backend.Memory.Store(out.records, out.fields);
      }

      self.set(results.metadata);


        // if labels are declared in dataset properties merge it;
        if(self.attributes.fieldLabels) {
            for(var i=0; i<out.fields.length; i++) {
                var tmp  = _.find(self.attributes.fieldLabels, function(x){ return x.id==out.fields[i].id; });
                if(tmp != null)
                  out.fields[i].label = tmp.label;

            }

        }

        // if format is desclared is updated
        if(self.attributes.fieldsFormat) {
        // if format is declared in dataset properties merge it;
        _.each(self.attributes.fieldsFormat, function(d) {
            var field = _.find(out.fields, function(f) {return d.id === f.id });
            if(field != null)
                field.format = d.format;
        })
        }



        // assignment of color schema to fields
        if(self.attributes.colorSchema) {
            _.each(self.attributes.colorSchema, function(d) {
                var field = _.find(out.fields, function(f) {return d.field === f.id });
                if(field != null)
                    field.colorSchema = d.schema;
            })
        }

        self.fields.reset(out.fields, {renderer: recline.Data.Renderers});

        self.query()
        .done(function() {
          dfd.resolve(self);
        })
        .fail(function(arguments) {
          dfd.reject(arguments);
        });
    }

    return dfd.promise();
  },

  setColorSchema: function() {
      var self=this;
      _.each(self.attributes.colorSchema, function(d) {
          var field = _.find(self.fields.models, function(f) {
              return d.field === f.id
          });
          if(field != null)
              field.attributes.colorSchema = d.schema;
      })
  },

  // ### _normalizeRecordsAndFields
  // 
  // Get a proper set of fields and records from incoming set of fields and records either of which may be null or arrays or objects
  //
  // e.g. fields = ['a', 'b', 'c'] and records = [ [1,2,3] ] =>
  // fields = [ {id: a}, {id: b}, {id: c}], records = [ {a: 1}, {b: 2}, {c: 3}]
  _normalizeRecordsAndFields: function(records, fields) {
    // if no fields get them from records
    if (!fields && records && records.length > 0) {
      // records is array then fields is first row of records ...
      if (records[0] instanceof Array) {
        fields = records[0];
        records = records.slice(1);
      } else {
        fields = _.map(_.keys(records[0]), function(key) {
          return {id: key};
        });
      }
    } 

    // fields is an array of strings (i.e. list of field headings/ids)
    if (fields && fields.length > 0 && typeof fields[0] === 'string') {
      // Rename duplicate fieldIds as each field name needs to be
      // unique.
      var seen = {};
      fields = _.map(fields, function(field, index) {
        // cannot use trim as not supported by IE7
        var fieldId = field.replace(/^\s+|\s+$/g, '');
        if (fieldId === '') {
          fieldId = '_noname_';
          field = fieldId;
        }
        while (fieldId in seen) {
          seen[field] += 1;
          fieldId = field + seen[field];
        }
        if (!(field in seen)) {
          seen[field] = 0;
        }
        // TODO: decide whether to keep original name as label ...
        // return { id: fieldId, label: field || fieldId }
        return { id: fieldId };
      });
    }
    // records is provided as arrays so need to zip together with fields
    // NB: this requires you to have fields to match arrays
    if (records && records.length > 0 && records[0] instanceof Array) {
      records = _.map(records, function(doc) {
        var tmp = {};
        _.each(fields, function(field, idx) {
          tmp[field.id] = doc[idx];
        });
        return tmp;
      });
    }
    return {
      fields: fields,
      records: records
    };
  },

  save: function() {
    var self = this;
    // TODO: need to reset the changes ...
    return this._store.save(this._changes, this.toJSON());
  },

  transform: function(editFunc) {
    var self = this;
    if (!this._store.transform) {
      alert('Transform is not supported with this backend: ' + this.get('backend'));
      return;
    }
    this.trigger('recline:flash', {message: "Updating all visible docs. This could take a while...", persist: true, loader: true});
    this._store.transform(editFunc).done(function() {
      // reload data as records have changed
      self.query();
      self.trigger('recline:flash', {message: "Records updated successfully"});
    });
  },

    getRecords: function(type) {
        var self=this;

        if(type==='filtered'){
            return self.records.models;
        }else {
            throw "Model.js: accessing to data for type " + type + " not implemented"
        }
    },

  // ### query
  //
  // AJAX method with promise API to get records from the backend.
  //
  // It will query based on current query state (given by this.queryState)
  // updated by queryObj (if provided).
  //
  // Resulting RecordList are used to reset this.records and are
  // also returned.
  query: function(queryObj) {


    var self = this;
    var dfd = $.Deferred();
    this.trigger('query:start');

    if (queryObj) {
      this.queryState.set(queryObj, {silent: true});
    }
    var actualQuery = this.queryState.toJSON();

    console.log("Query on model [" + self.attributes.id + "] query [" + JSON.stringify(actualQuery) + "]");

    this._store.query(actualQuery, this.toJSON())
      .done(function(queryResult) {
        self._handleQueryResult(queryResult);
        self.trigger('query:done');
        dfd.resolve(self.records);
      })
      .fail(function(arguments) {
        self.trigger('query:fail', arguments);
        dfd.reject(arguments);
      });
    return dfd.promise();
  },

  _handleQueryResult: function(queryResult) {
    var self = this;
    self.recordCount = queryResult.total;
    var docs = _.map(queryResult.hits, function(hit) {
      var _doc = new my.Record(hit);
      _doc.fields = self.fields;
      _doc.bind('change', function(doc) {
        self._changes.updates.push(doc.toJSON());
      });
      _doc.bind('destroy', function(doc) {
        self._changes.deletes.push(doc.toJSON());
      });
      return _doc;
    });

    recline.Data.Filters.applySelectionsOnData(self.queryState.get('selections'), docs, self.fields);
    self.records.reset(docs);

    if (queryResult.facets) {
      var facets = _.map(queryResult.facets, function(facetResult, facetId) {
        facetResult.id = facetId;
        var result =  new my.Facet(facetResult);
        self.addColorsToTerms(facetId, result.attributes.terms);

        return result;
      });
      self.facets.reset(facets);
    }
  },

    addColorsToTerms: function(field, terms) {
        var self=this;
        _.each(terms, function(t) {

            // assignment of color schema to fields
            if(self.attributes.colorSchema) {
                _.each(self.attributes.colorSchema, function(d) {
                    if(d.field===field)
                        t.color = d.schema.getColorFor(t.term);
                })
            }
            });
        },


    selection: function(queryObj) {
        var self = this;

        this.trigger('selection:start');

        if (queryObj) {
            self.queryState.set(queryObj, {silent: true});
        }
        var actualQuery = self.queryState

        // if memory store apply on memory
        /*if (self.backend == recline.Backend.Memory
            || self.backend == recline.Backend.Jsonp) {
            self.backend.applySelections(this.queryState.get('selections'));
        }*/

        // apply on current records
        // needed cause memory store is not mandatory
        recline.Data.Filters.applySelectionsOnData(self.queryState.get('selections'), self.records.models, self.fields);

        self.queryState.trigger('selection:done');

    },


  toTemplateJSON: function() {
    var data = this.toJSON();
    data.recordCount = this.recordCount;
    data.fields = this.fields.toJSON();
    return data;
  },

  // ### getFieldsSummary
  //
  // Get a summary for each field in the form of a `Facet`.
  // 
  // @return null as this is async function. Provides deferred/promise interface.
  getFieldsSummary: function() {
    var self = this;
    var query = new my.Query();
    query.set({size: 0});
    this.fields.each(function(field) {
      query.addFacet(field.id);
    });
    var dfd = $.Deferred();
    this._store.query(query.toJSON(), this.toJSON()).done(function(queryResult) {
      if (queryResult.facets) {
        _.each(queryResult.facets, function(facetResult, facetId) {
          facetResult.id = facetId;
          var facet = new my.Facet(facetResult);
          // TODO: probably want replace rather than reset (i.e. just replace the facet with this id)
          self.fields.get(facetId).facets.reset(facet);
        });
      }
      dfd.resolve(queryResult);
    });
    return dfd.promise();
  },

  // Deprecated (as of v0.5) - use record.summary()
  recordSummary: function(record) {
    return record.summary();
  },

  // ### _backendFromString(backendString)
  //
  // Look up a backend module from a backend string (look in recline.Backend)
  _backendFromString: function(backendString) {
    var backend = null;
    if (recline && recline.Backend) {
      _.each(_.keys(recline.Backend), function(name) {
        if (name.toLowerCase() === backendString.toLowerCase()) {
          backend = recline.Backend[name];
        }
      });
    }
    return backend;
  },
  isFieldPartitioned: function(field) { return false
  },
  getFacetByFieldId: function(fieldId) {
  	  return _.find(this.facets.models, function(facet) {
  		  return facet.id == fieldId;
  	  });
  }  
});


// ## <a id="record">A Record</a>
// 
// A single record (or row) in the dataset
my.Record = Backbone.Model.extend({
  constructor: function Record() {
    Backbone.Model.prototype.constructor.apply(this, arguments);
  },

  // ### initialize
  // 
  // Create a Record
  //
  // You usually will not do this directly but will have records created by
  // Dataset e.g. in query method
  //
  // Certain methods require presence of a fields attribute (identical to that on Dataset)
  initialize: function() {
    _.bindAll(this, 'getFieldValue');

     this["is_selected"] = false;
  },

  // ### getFieldValue
  //
  // For the provided Field get the corresponding rendered computed data value
  // for this record.
  getFieldValue: function(field) {
    val = this.getFieldValueUnrendered(field);
    if (field.renderer) {
      val = field.renderer(val, field, this.toJSON());
    }
    return val;
  },

  // ### getFieldValueUnrendered
  //
  // For the provided Field get the corresponding computed data value
  // for this record.
  getFieldValueUnrendered: function(field) {
    var val = this.get(field.id);
    if (field.deriver) {
      val = field.deriver(val, field, this);
    }
    return val;
  },

    getFieldColor: function(field) {
        if(!field.attributes.colorSchema)
            return null;

        if(field.attributes.is_partitioned) {
            return field.attributes.colorSchema.getTwoDimensionalColor(field.attributes.partitionValue, this.getFieldValueUnrendered(field) );
        }
        else
            return field.attributes.colorSchema.getColorFor( this.getFieldValueUnrendered(field));

    },

  isRecordSelected: function() {
    var self=this;
      return self["is_selected"];
  },
  setRecordSelection: function(sel) {
      var self=this;
      self["is_selected"] = sel;
  },

  // ### summary
  //
  // Get a simple html summary of this record in form of key/value list
  summary: function(record) {
    var self = this;
    var html = '<div class="recline-record-summary">';
    this.fields.each(function(field) { 
      if (field.id != 'id') {
        html += '<div class="' + field.id + '"><strong>' + field.get('label') + '</strong>: ' + self.getFieldValue(field) + '</div>';
      }
    });
    html += '</div>';
    return html;
  },

  // Override Backbone save, fetch and destroy so they do nothing
  // Instead, Dataset object that created this Record should take care of
  // handling these changes (discovery will occur via event notifications)
  // WARNING: these will not persist *unless* you call save on Dataset
  fetch: function() {},
  save: function() {},
  destroy: function() { this.trigger('destroy', this); }
});


// ## A Backbone collection of Records
my.RecordList = Backbone.Collection.extend({
  constructor: function RecordList() {
    Backbone.Collection.prototype.constructor.apply(this, arguments);
  },
  model: my.Record
});


// ## <a id="field">A Field (aka Column) on a Dataset</a>
my.Field = Backbone.Model.extend({
  constructor: function Field() {
    Backbone.Model.prototype.constructor.apply(this, arguments);
  },
  // ### defaults - define default values
  defaults: {
    label: null,
    type: 'string',
    format: null,
    is_derived: false,
    is_partitioned: false,
    partitionValue: null,
    partitionField: null,
    colorSchema: null
  },
  virtualModelFields: {
      label: null,
      type: 'string',
      format: null,
      is_derived: false,
      is_partitioned: false,
      partitionValue: null,
      partitionField: null,
      originalField: null,
      colorSchema: null,
      aggregationFunction: null
  },
  // ### initialize
  //
  // @param {Object} data: standard Backbone model attributes
  //
  // @param {Object} options: renderer and/or deriver functions.
  initialize: function(data, options) {
    // if a hash not passed in the first argument throw error
    if ('0' in data) {
      throw new Error('Looks like you did not pass a proper hash with id to Field constructor');
    }
    if (this.attributes.label === null) {
      this.set({label: this.id});
    }
    if (options) {
      this.renderer = options.renderer;
      this.deriver = options.deriver;
    }
    if (!this.renderer) {
      this.renderer = this.defaultRenderers[this.get('type')];
    }
    this.facets = new my.FacetList();
  },
  getColorForPartition: function() {

      if(!this.attributes.colorSchema || !this.attributes.is_partitioned)
          return null;

      return this.attributes.colorSchema.getColorFor(this.attributes.partitionValue);
  },
  defaultRenderers: {
    object: function(val, field, doc) {
      return JSON.stringify(val);
    },
    geo_point: function(val, field, doc) {
      return JSON.stringify(val);
    },
    'float': function(val, field, doc) {
      var format = field.get('format'); 
      if (format === 'percentage') {
        return val + '%';
      }
      return val;
    },
    'string': function(val, field, doc) {
      var format = field.get('format');
      if (format === 'markdown') {
        if (typeof Showdown !== 'undefined') {
          var showdown = new Showdown.converter();
          out = showdown.makeHtml(val);
          return out;
        } else {
          return val;
        }
      } else if (format == 'plain') {
        return val;
      } else {
        // as this is the default and default type is string may get things
        // here that are not actually strings
        if (val && typeof val === 'string') {
          val = val.replace(/(https?:\/\/[^ ]+)/g, '<a href="$1">$1</a>');
        }
        return val
      }
    },
	'date': function(val, field, doc) {
		// if val contains timer value (in msecs), possibly in string format, ensure it's converted to number
		var intVal = parseInt(val);
		if (!isNaN(intVal) && isFinite(val))
			return intVal;
		else return new Date(val);
	}
  }
});

my.FieldList = Backbone.Collection.extend({
  constructor: function FieldList() {
    Backbone.Collection.prototype.constructor.apply(this, arguments);
  },
  model: my.Field
});

// ## <a id="query">Query</a>
my.Query = Backbone.Model.extend({
  constructor: function Query() {
    Backbone.Model.prototype.constructor.apply(this, arguments);
  },
  defaults: function() {
    return {
      //size: 100,
      from: 0,
      q: '',
      facets: {},
      filters: [],
      selections: []
    };
  },
  _filterTemplates: {
    term: {
      type: 'term',
      // TODO do we need this attribute here?
      field: '',
      term: ''
    },
    termAdvanced: {
          type: 'term',
          operator : "eq",
          field: '',
          term: ''
      },
    list: {
      type: 'term',
      field: '',
      list: []
    },
    range: {
      type: 'range',
      field: '',
      start: '',
      stop: ''
    },
    geo_distance: {
      type: 'geo_distance',
      distance: 10,
      unit: 'km',
      point: {
        lon: 0,
        lat: 0
      }
    }
  // ### addFilter(filter)
  },
      _selectionTemplates: {
          term: {
              type: 'term',
              field: '',
              term: ''
          },
          range: {
              type: 'range',
              field: '',
              start: '',
              stop: ''
          }
      },
  // ### addFilter
  //
  // Add a new filter specified by the filter hash and append to the list of filters
  //
  // @param filter an object specifying the filter - see _filterTemplates for examples. If only type is provided will generate a filter by cloning _filterTemplates
  addFilter: function(filter) {
    // crude deep copy
    var ourfilter = JSON.parse(JSON.stringify(filter));
    // not fully specified so use template and over-write
    if (_.keys(filter).length <= 3) {
      ourfilter = _.extend(this._filterTemplates[filter.type], ourfilter);
    }
    var filters = this.get('filters');
    filters.push(ourfilter);
    this.trigger('change:filters:new-blank');
  },

    getFilters: function(){
      return this.get('filters');
    },

    getFilterByFieldName: function(fieldName) {
      var res = _.find(this.get('filters'), function(f) {
          return f.field == fieldName;
      });
      if(res == -1)
          return null;
      else
          return res;

    },


    // update or add the selected filter(s), a change event is triggered after the update

  setFilter: function(filter) {
  	  if(filter["remove"]) {
  	  	removeFilterByField(filter.field);
  	  }else{
  	
		var filters = this.get('filters');
		var found = false;
		for(var j=0;j<filters.length;j++) {
			if (filters[j].field==filter.field) {
				filters[j] = filter;
				found = true;
			}
		}
		if(!found)
			filters.push(filter);
		}
  },



  updateFilter: function(index, value) {
  },
  // ### removeFilter
  //
  // Remove a filter from filters at index filterIndex
  removeFilter: function(filterIndex) {
    var filters = this.get('filters');
    filters.splice(filterIndex, 1);
    this.set({filters: filters});
    this.trigger('change');
  },
  removeFilterByField: function(field) {
    var filters = this.get('filters');
	for (var j in filters)
	{
		if (filters[j].field == field)
		{
			removeFilter(j);
		}
	}
  },
  clearFilter: function(field) {
    var filters = this.get('filters');
	for (var j in filters)
	{
		if (filters[j].field == field)
		{
			filters[j].term = null;
			filters[j].start = null;
			filters[j].stop = null;
			break;
		}
	}
  },

      // ### addSelection
      //
      // Add a new selection (appended to the list of selections)
      //
      // @param selection an object specifying the filter - see _filterTemplates for examples. If only type is provided will generate a filter by cloning _filterTemplates
      addSelection: function(selection) {
          // crude deep copy
          var myselection = JSON.parse(JSON.stringify(selection));
          // not full specified so use template and over-write
          // 3 as for 'type', 'field' and 'fieldType'
          if (_.keys(selection).length <= 3) {
              myselection = _.extend(this._selectionTemplates[selection.type], myselection);
          }
          var selections = this.get('selections');
          selections.push(myselection);
          this.trigger('change:selections');
      },
      // ### removeSelection
      //
      // Remove a selection at index selectionIndex
      removeSelection: function(selectionIndex) {
          var selections = this.get('selections');
          selections.splice(selectionIndex, 1);
          this.set({selections: selections});
          this.trigger('change:selections');
      },
       removeSelectionByField: function(field) {
    var selections = this.get('selections');
	for (var j in filters)
	{
		if (selections[j].field == field)
		{
			removeSelection(j);
		}
	}
  },
      setSelection: function(filter) {
      	  if(filter["remove"]) {
  	  	removeSelectionByField(filter.field);
  	  }else{
  	
  	
        var s = this.get('selections');
        var found = false;
        for(var j=0;j<s.length;j++) {
            if (s[j].field==filter.field) {
                s[j] = filter;
                found = true;
            }
        }
        if(!found)
            s.push(filter);
           }
    },



  // ### addFacet
  //
  // Add a Facet to this query
  //
  // See <http://www.elasticsearch.org/guide/reference/api/search/facets/>
  addFacet: function(fieldId) {
      this.addFacetNoEvent(fieldId);
      this.trigger('facet:add', this);
    },


  addFacetNoEvent: function(fieldId) {
    var facets = this.get('facets');
    // Assume id and fieldId should be the same (TODO: this need not be true if we want to add two different type of facets on same field)
    if (_.contains(_.keys(facets), fieldId)) {
      return;
    }
    facets[fieldId] = {
      terms: { field: fieldId }
    };
    this.set({facets: facets}, {silent: true});

  },

    addHistogramFacet: function(fieldId){
        addHistogramFacet(fieldId);
        this.trigger('facet:add', this);
    },

  addHistogramFacetNoEvent: function(fieldId) {
    var facets = this.get('facets');
    facets[fieldId] = {
      date_histogram: {
        field: fieldId,
        interval: 'day'
      }
    };
    this.set({facets: facets}, {silent: true});

  }


});


// ## <a id="facet">A Facet (Result)</a>
my.Facet = Backbone.Model.extend({
  constructor: function Facet() {
    Backbone.Model.prototype.constructor.apply(this, arguments);
  },
  defaults: function() {
    return {
      _type: 'terms',
      total: 0,
      other: 0,
      missing: 0,
      terms: []
    };
  }
});

// ## A Collection/List of Facets
my.FacetList = Backbone.Collection.extend({
  constructor: function FacetList() {
    Backbone.Collection.prototype.constructor.apply(this, arguments);
  },
  model: my.Facet
});

// ## Object State
//
// Convenience Backbone model for storing (configuration) state of objects like Views.
my.ObjectState = Backbone.Model.extend({
});


// ## Backbone.sync
//
// Override Backbone.sync to hand off to sync function in relevant backend
Backbone.sync = function(method, model, options) {
  return model.backend.sync(method, model, options);
};

}(jQuery, this.recline.Model));

