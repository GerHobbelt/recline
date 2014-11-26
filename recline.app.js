/**
 * @file
 * Provides options for recline visualization.
 */

(function ($) {
    var maxLabelWidth = 77;
    var labelMargin = 5;

    Drupal.behaviors.Recline = {
        attach: function (context) {
            var delimiter = Drupal.settings.recline.delimiter;
            var file = Drupal.settings.recline.file;
            var uuid = Drupal.settings.recline.uuid;
            var dkan = Drupal.settings.recline.dkan;
            var fileType = Drupal.settings.recline.fileType;
            var dataExplorerSettings = {
                grid: Drupal.settings.recline.grid,
                graph: Drupal.settings.recline.graph,
                map: Drupal.settings.recline.map
            };

            window.dataExplorer = null;
            window.explorerDiv = $('.data-explorer');

            // This is the very basic state collection.
            var state = recline.View.parseQueryString(decodeURIComponent(window.location.hash));
            if ('#map' in state) {
                state['currentView'] = 'map';
            } else if ('#graph' in state) {
                state['currentView'] = 'graph';
            } else if ('#timeline' in state) {
                state['currentView'] = 'timeline';
            }
            // Checks if dkan_datastore is installed.
            if (dkan) {
                var drupal_base_path = Drupal.settings.basePath;
                var DKAN_API = drupal_base_path + 'api/action/datastore/search.json';
                var url = window.location.origin + DKAN_API + '?resource_id=' + uuid;
                var DkanDatastore = false;
                var DkanApi = $.ajax({
                    type: 'GET',
                    url: url,
                    dataType: 'json',
                    success: function(data, status) {
                        if ('success' in data && data.success) {
                            var dataset = new recline.Model.Dataset({
                                endpoint: window.location.origin + drupal_base_path + '/api',
                                url: url,
                                id: uuid,
                                backend: 'ckan'
                            });
                            dataset.fetch();
                            return createExplorer(dataset, state, dataExplorerSettings);
                        }
                        else {
                            $('.data-explorer').append('<div class="messages status">Error returned from datastore: ' + data + '.</div>');
                        }

                    },
                    error: function(data, status) {
                        $('.data-explorer').append('<div class="messages status">Unable to connect to the datastore.</div>');
                    }
                });
            }
            else if (fileType == 'text/csv') {
                var options = {delimiter: delimiter};
                $.ajax({
                    url: file,
                    dataType: "text",
                    timeout: 500,
                    success: function(data) {
                        // Converts line endings in either format to unix format.
                        data = data.replace(/(\r\n|\n|\r)/gm,"\n");
                        var dataset = new recline.Model.Dataset({
                            records: recline.Backend.CSV.parseCSV(data, options)
                        });
                        dataset.fetch();
                        var views = createExplorer(dataset, state, dataExplorerSettings);
                        // The map needs to get redrawn when we are delivering from the ajax
                        // call.
                        $.each(views, function(i, view) {
                            if (view.id == 'map') {
                                view.view.redraw('refresh');
                            }
                        });
                    },
                    error: function(x, t, m) {
                        if (t === "timeout") {
                            $('.data-explorer').append('<div class="messages status">File was too large or unavailable for preview.</div>');
                        } else {
                            $('.data-explorer').append('<div class="messages status">Data preview unavailable.</div>');
                        }
                    }
                });
            }
            // Checks if xls.
            else if (fileType == 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || fileType == 'application/vnd.ms-excel') {
                var dataset = new recline.Model.Dataset({
                    url: file,
                    backend: 'dataproxy'
                });
                dataset.fetch();
                var views = createExplorer(dataset, state, dataExplorerSettings);
            }
            else {
                $('.data-explorer').append('<div class="messages status">File type ' + fileType + ' not supported for preview.</div>');
            }
        }
    };

    // make Explorer creation / initialization in a function so we can call it
    // again and again
    var createExplorer = function(dataset, state, settings) {
        // remove existing data explorer view
        var reload = false;
        if (window.dataExplorer) {
            window.dataExplorer.remove();
            reload = true;
        }
        window.dataExplorer = null;
        var $el = $('<div />');
        $el.appendTo(window.explorerDiv);

        var views = [];

        if (settings.grid) {
            views.push(
                {
                    id: 'grid',
                    label: 'Grid',
                    view: new recline.View.SlickGrid({
                        model: dataset
                    })
                }
            );
        }
        if (settings.graph) {
            var state = {
                graphOptions:{
                    xaxis: {
                        tickFormatter:tickFormatter(dataset),
                    },
                    hooks:{
                        processOffset:[processOffset(dataset)],
                        bindEvents: [bindEvents],
                    }
                }
            };
            views.push(
                {
                    id: 'graph',
                    label: 'Graph',
                    view: new recline.View.Graph({
                        model: dataset,
                        state: state
                    })
                }
            );
        }
        if (settings.map) {
            views.push(
                {
                    id: 'map',
                    label: 'Map',
                    view: new recline.View.Map({
                        model: dataset
                    })
                }
            );
        }

        Drupal.settings.recline.args = {
            model: dataset,
            el: $el,
            state: state,
            views: views
        };

        window.dataExplorer = new recline.View.MultiView(Drupal.settings.recline.args);
        $.event.trigger('createDataExplorer');
        return views;
    };

    $(".recline-embed a.embed-link").live('click', function(){
      $(this).parents('.recline-embed').find('.embed-code-wrapper').toggle();
      return false;
    });

    function isInverted(){
        return dataExplorer.pageViews[1].view.state.attributes.graphType === 'bars';
    };

    function computeWidth (plot, labels) {
        var biggerLabel = '';
        for( var i = 0; i < labels.length; i++){
            if(labels[i].length > biggerLabel.length && !_.isUndefined(labels[i])){
                biggerLabel = labels[i];
            }
        };
        var canvas = plot.getCanvas();
        var ctx = canvas.getContext('2d');
        ctx.font = 'sans-serif smaller';
        return ctx.measureText(biggerLabel).width;
    };

    function resize (plot) {
        var itemWidth = computeWidth(plot, _.pluck(plot.getXAxes()[0].ticks, 'label'));
        var graph = dataExplorer.pageViews[1];
        if(!isInverted() && $('#prevent-label-overlapping').is(':checked')){
            var canvasWidth = Math.min(itemWidth + labelMargin, maxLabelWidth) * plot.getXAxes()[0].ticks.length;
            var canvasContainerWith = $('.panel.graph').parent().width();
            if(canvasWidth < canvasContainerWith){
                canvasWidth = canvasContainerWith;
            }
            $('.panel.graph').width(canvasWidth);
            $('.recline-flot').css({overflow:'auto'});
        }else{
            $('.recline-flot').css({overflow:'hidden'});
            $('.panel.graph').css({width: '100%'});
        }
        plot.resize();
        plot.setupGrid();
        plot.draw();
    };

    function bindEvents (plot, eventHolder) {
        var p = plot || dataExplorer.pageViews[1].view.plot;
        resize(p);
        setTimeout(addCheckbox, 0);
    };

    function processOffset (dataset) {
        return function(plot, offset) {
            if(dataExplorer.pageViews[1].view.xvaluesAreIndex){
                var series = plot.getData();
                for (var i = 0; i < series.length; i++) {
                      var numTicks = Math.min(dataset.records.length, 200);
                      var ticks = [];
                      for (var j = 0; j < dataset.records.length; j++) {
                        ticks.push(parseInt(j, 10));
                      }
                      if(isInverted()){
                        series[i].yaxis.options.ticks = ticks;
                      }else{
                        series[i].xaxis.options.ticks = ticks;
                      }
                }
            }
        };
    };

    function tickFormatter(dataset){
        return function (x) {
            x = parseInt(x, 10);
            try {
                if(isInverted()){
                    return x;
                }
                var field = dataExplorer.pageViews[1].view.state.get('group');
                var label = dataset.records.models[x].get(field) || "";
                if(!moment(String(label)).isValid() && !isNaN(parseInt(label, 10))){
                    label = parseInt(label, 10) - 1;
                }
                return label;
            } catch(e) {
                return x;
            }
        };
    };

    function addCheckbox() {
        $control = $('.form-stacked:visible').find('#prevent-label-overlapping');
        if(!$control.length){
            $form = $('.form-stacked');
            $checkboxDiv = $('<div class="checkbox"></div>').appendTo($form);
            $label = $('<label />', { 'for': 'prevent-label-overlapping', text: 'Resize graph to prevent label overlapping' }).appendTo($checkboxDiv);
            $label.prepend($('<input />', { type: 'checkbox', id: 'prevent-label-overlapping', value: '' }));
            $control = $('#prevent-label-overlapping');
            $control.on('change', function(){
                resize(dataExplorer.pageViews[1].view.plot);
            });
        }
    };

})(jQuery);
