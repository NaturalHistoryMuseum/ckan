this.ckan.module('recline_view', function (jQuery, _) {
  var NoRecordsView = Backbone.View.extend({
    template: '<div class="recline-norecords">{{text}}</div>',
    render: function(){
      var self = this;
      var htmls = Mustache.render(self.template, {text: self.options.i18n.noRecords});
      self.$el.html(htmls);
    }
  });
  return {
    options: {
      i18n: {
        errorLoadingPreview: "Could not load view",
        errorDataProxy: "DataProxy returned an error",
        errorDataStore: "DataStore returned an error",
        previewNotAvailableForDataType: "View not available for data type: ",
        noRecords: "No matching records"
      },
      site_url: "",
      controlsClassName: "controls"
    },

    initialize: function () {
      jQuery.proxyAll(this, /_on/);
      this.options.resource = JSON.parse(this.options.resource);
      this.options.resourceView = JSON.parse(this.options.resourceView);
      this.el.ready(this._onReady);
      // hack to make leaflet use a particular location to look for images
      L.Icon.Default.imagePath = this.options.site_url + 'vendor/leaflet/0.4.4/images';
    },

    _onReady: function() {
      var resourceData = this.options.resource,
          resourceView = this.options.resourceView;

      this.loadView(resourceData, resourceView);
    },

    loadView: function (resourceData, reclineView) {
      var self = this;

      function showError(msg){
        msg = msg || _('error loading view');
        window.parent.ckan.pubsub.publish('data-viewer-error', msg);
      }

      resourceData.url  = this.normalizeUrl(resourceData.url);
      if (resourceData.formatNormalized === '') {
        var tmp = resourceData.url.split('/');
        tmp = tmp[tmp.length - 1];
        tmp = tmp.split('?'); // query strings
        tmp = tmp[0];
        var ext = tmp.split('.');
        if (ext.length > 1) {
          resourceData.formatNormalized = ext[ext.length-1];
        }
      }

      var errorMsg, dataset;

      resourceData.backend =  'ckan';
      resourceData.endpoint = jQuery('body').data('site-root') + 'api';

      dataset = new recline.Model.Dataset(resourceData);

      var query = new recline.Model.Query();
      query.set({ size: reclineView.limit || 100 });
      query.set({ from: reclineView.offset || 0 });
      if (window.parent.ckan.views && window.parent.ckan.views.filters) {
        var defaultFilters = reclineView.filters || {},
            urlFilters = window.parent.ckan.views.filters.get(),
            filters = $.extend({}, defaultFilters, urlFilters);
        $.each(filters, function (field,values) {
          query.addFilter({type: 'term', field: field, term: values});
        });
        if (window.parent.ckan.views.filters.getFullText()){
          query.set({ q: window.parent.ckan.views.filters.getFullText()});
        }
      }

      dataset.queryState.set(query.toJSON(), {silent: true});

      errorMsg = this.options.i18n.errorLoadingPreview + ': ' + this.options.i18n.errorDataStore;
      dataset.fetch()
        .done(function(dataset){
            self.initializeView(dataset, reclineView);
        })
        .fail(function(error){
          if (error.message) errorMsg += ' (' + error.message + ')';
          showError(errorMsg);
        });
    },

    initializeView: function (dataset, reclineView) {
      var view,
          state,
          controls = [];

      if(typeof(dataset.recordCount) == 'undefined' || dataset.recordCount == 0){
        view = new NoRecordsView({
          'model': dataset,
          i18n: {noRecords:this.options.i18n.noRecords}
        });
      } else if(reclineView.view_type === "recline_graph_view") {
        state = {
          "graphType": reclineView.graph_type,
          "group": reclineView.group,
          "series": [reclineView.series]
        };
        view = new recline.View.Graph({model: dataset, state: state});
      } else if(reclineView.view_type === "recline_map_view") {
        state = {
          geomField: null,
          latField: null,
          lonField: null,
          autoZoom: Boolean(reclineView.auto_zoom),
          cluster: Boolean(reclineView.cluster_markers)
        };

        if(reclineView.map_field_type === "geojson") {
          state.geomField = reclineView.geojson_field;
        } else {
          state.latField = reclineView.latitude_field;
          state.lonField = reclineView.longitude_field;
        }

        view = new recline.View.Map({model: dataset, state: state});
      } else if(reclineView.view_type === "recline_view") {
        view = this._newDataExplorer(dataset);
      } else {
        // default to Grid

        if (reclineView.state === undefined) {
            reclineView.state = {}
        }else{
            // Loop through all properties that could be functions
            // If they are defined, convert to func
            $.each(['defaultFormatter', 'formatterFactory', 'editorFactory'], function(i, value){
                if(reclineView.state['gridOptions'][value] !== undefined){
                    // String to func
                    reclineView.state['gridOptions'][value] = window[reclineView.state['gridOptions'][value]];
                }
            });
        }

        view = new recline.View.SlickGrid({model: dataset, state: reclineView.state});
        controls = [
          new recline.View.Pager({model: view.model}),
          new recline.View.RecordCount({model: dataset}),
          new recline.View.QueryEditor({model: view.model.queryState})
        ];
      }

      // recline_view automatically adds itself to the DOM, so we don't
      // need to bother with it.
      if(reclineView.view_type !== 'recline_view') {
        var newElements = $('<div />');
        this._renderControls(newElements, controls, this.options.controlsClassName);
        newElements.append(view.el);
        $(this.el).html(newElements);
        view.visible = true;
        view.render();
      }

      if(reclineView.view_type === "recline_graph_view") {
        view.redraw();
      }
    },

    _newDataExplorer: function (dataset) {
      var views = [
        {
          id: 'grid',
          label: 'Grid',
          view: new recline.View.SlickGrid({
            model: dataset
          })
        },
        {
          id: 'graph',
          label: 'Graph',
          view: new recline.View.Graph({
            model: dataset
          })
        },
        {
          id: 'map',
          label: 'Map',
          view: new recline.View.Map({
            model: dataset
          })
        }
      ];

      var sidebarViews = [
        {
          id: 'valueFilter',
          label: 'Filters',
          view: new recline.View.ValueFilter({
            model: dataset
          })
        }
      ];

      var dataExplorer = new recline.View.MultiView({
        el: this.el,
        model: dataset,
        views: views,
        sidebarViews: sidebarViews,
        config: {
          readOnly: true
        }
      });

      return dataExplorer;
    },

    normalizeUrl: function (url) {
      if (url.indexOf('https') === 0) {
        return 'http' + url.slice(5);
      } else {
        return url;
      }
    },

    _renderControls: function (el, controls, className) {
      var controlsEl = $("<div class=\"clearfix " + className + "\" />");
      for (var i = 0; i < controls.length; i++) {
        controlsEl.append(controls[i].el);
      }
      $(el).append(controlsEl);
    }
  };
});
