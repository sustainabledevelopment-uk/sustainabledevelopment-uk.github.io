Chart.plugins.register({
  id: 'rescaler',
  beforeInit: function (chart, options) {
    chart.config.data.allLabels = chart.config.data.labels.slice(0);
  },
  afterDatasetsUpdate: function (chart) {
    _.each(chart.data.datasets, function (ds) {
      if (!ds.initialised) {
        ds.initialised = true;
        ds.allData = ds.data.slice(0);
      }
    });
  },
  afterUpdate: function (chart) {

    if (chart.isScaleUpdate) {
      chart.isScaleUpdate = false;
      return;
    }

    var datasets = _.filter(chart.data.datasets, function (ds, index) {
      var meta = chart.getDatasetMeta(index).$filler;
      return meta && meta.visible;
    });

    var ranges = _.chain(datasets).pluck('allData').map(function (data) {
      return {
        min: _.findIndex(data, _.identity),
        max: _.findLastIndex(data, _.identity)
      };
    }).value();

    var dataRange = ranges.length ? {
      min: _.chain(ranges).pluck('min').min().value(),
      max: _.chain(ranges).pluck('max').max().value()
    } : undefined;

    if (dataRange) {
      chart.data.labels = chart.data.allLabels.slice(dataRange.min, dataRange.max + 1);

      chart.data.datasets.forEach(function (dataset) {
        dataset.data = dataset.allData.slice(dataRange.min, dataRange.max + 1);
      });

      chart.isScaleUpdate = true;
      chart.update();
    }
  }
});
function event(sender) {
  this._sender = sender;
  this._listeners = [];
}

event.prototype = {
  attach: function (listener) {
    this._listeners.push(listener);
  },
  notify: function (args) {
    var index;

    for (index = 0; index < this._listeners.length; index += 1) {
      this._listeners[index](this._sender, args);
    }
  }
};

var indicatorDataStore = function(dataUrl) {
  this.dataUrl = dataUrl;

  this.getData = function() {
    that = this;
    return new Promise(function(resolve, reject) {

      // if(Modernizr.localStorage &&) {

      // }

      $.getJSON(that.dataUrl, function(data) {
        resolve(data);
      }).fail(function(err) {
        reject(Error(err));
      });      
    });
  };

};
var indicatorModel = function (options) {

  Array.prototype.containsValue = function(val) {
    return this.indexOf(val) != -1;
  };

  // events:
  this.onDataComplete = new event(this);
  this.onSeriesComplete = new event(this);
  this.onSeriesSelectedChanged = new event(this);
  this.onUnitsComplete = new event(this);
  this.onUnitsSelectedChanged = new event(this);
  this.onFieldsStatusUpdated = new event(this);
  this.onFieldsCleared = new event(this);
  this.onSelectionUpdate = new event(this);
  this.onNoHeadlineData = new event(this);

  // data rounding:
  this.roundingFunc = options.roundingFunc || function(value) {
    var to = 3, mult = Math.pow(10, to - Math.floor(Math.log(Math.abs(value)) / Math.LN10) - 1);
    return Math.round(value * mult) / mult;
  };

  // general members:
  var that = this;
  this.data = options.data;
  this.edgesData = options.edgesData;
  this.hasHeadline = true;
  this.country = options.country;
  this.indicatorId = options.indicatorId;
  this.chartTitle = options.chartTitle;
  this.graphType = options.graphType;
  this.measurementUnit = options.measurementUnit;
  this.dataSource = options.dataSource;
  this.geographicalArea = options.geographicalArea;
  this.footnote = options.footnote;
  this.showData = options.showData;
  this.selectedFields = [];
  this.allowedFields = [];
  this.selectedUnit = undefined;
  this.fieldValueStatuses = [];
  this.userInteraction = {};

  // initialise the field information, unique fields and unique values for each field:
  (function initialise() {
    that.fieldItemStates = _.map(_.filter(Object.keys(that.data[0]), function (key) {
        // 'Value' may not be present, but 'Year' and '
        return ['Year', 'Value', 'Units'].indexOf(key) === -1;
      }), function(field) {
      return {
        field: field,
        values: _.map(_.chain(that.data).pluck(field).uniq().filter(function(f) { return f; }).value(),
          function(f) { return {
            value: f,
            state: 'default'
          };
        })
      };
    });

    var extractUnique = function(prop) {
      return _.chain(that.data).pluck(prop).uniq().sortBy(function(year) {
        return year;
      }).value();
    };

    that.years = extractUnique('Year');

    if(that.data[0].hasOwnProperty('Units')) {
      that.units = extractUnique('Units');
      that.selectedUnit = that.units[0];
    }

    that.selectableFields = _.pluck(that.fieldItemStates, 'field');

    // determine if there are any 'child' fields: those that can
    // only be selected if their parent has one or more selections:
    that.allowedFields = _.difference(that.selectableFields, _.pluck(that.edgesData, 'To'));

    // prepare the data according to the rounding function:
    that.data = _.map(that.data, function(item) {

      // only apply a rounding function for non-zero values:
      if(item.Value != 0) {
        item.Value = that.roundingFunc(item.Value);
      }

      // remove any undefined/null values:
      _.each(Object.keys(item), function(key) {
        if(_.isNull(item[key]) || _.isUndefined(item[key])) {
          delete item[key];
        }
      });

      return item;
    });

    that.datasetObject = {
      fill: false,
      pointHoverRadius: 5,
      pointBackgroundColor: '#ffffff',
      pointHoverBorderWidth: 1,
      tension: 0,
      spanGaps: false
    };
  }());

  var headlineColor = '777777';
  var colors = ['0082e5', '79c3fc', '005da7', 'ff9c18', 'f47d00', 'ad8cf3', '683ec9'];

  // allow headline + (2 x others)
  var maxDatasetCount = 2 * colors.length;

  this.getHeadline = function(fields) {
    var that = this, allUndefined = function (obj) {
      for (var loop = 0; loop < that.selectableFields.length; loop++) {
        if (obj[that.selectableFields[loop]])
          return false;
      }
      return true;
    };

    return _.chain(that.data)
      .filter(function (i) {
        return allUndefined(i);
      })
      .sortBy(function (i) {
        return that.selectedUnit ? i.Units : i.Year;
      })
      .map(function (d) {
        return _.pick(d, _.identity);
      })
      .value();
  };

  this.clearSelectedFields = function() {
    this.selectedFields = [];
    this.userInteraction = {};
    this.getData();
    this.onFieldsCleared.notify();
  };

  this.updateSelectedFields = function (fields, userInteraction) {
    this.selectedFields = fields;

    // update parent/child statuses:
    var selectedFields = _.pluck(this.selectedFields, 'field');
    _.each(this.edgesData, function(edge) {
      if(!_.contains(selectedFields, edge.From)) {
        // don't allow any child fields of this association:
        this.selectedFields = _.without(this.selectedFields, _.findWhere(this.selectedFields, {
          field: edge.From
        }));
      }
    });

    // reset the allowedFields:
    this.allowedFields = _.difference(this.selectableFields, _.pluck(this.edgesData, 'To'));

    // and reinstate based on selectedFields:
    var parentFields = _.pluck(this.edgesData, 'From');
    _.each(parentFields, function(parentField) {
      if(_.contains(selectedFields, parentField)) {
        // resinstate
        that.allowedFields = that.allowedFields.concat(
          _.chain(that.edgesData).where({ 'From' : parentField }).pluck('To').value()
        );
      }
    });

    // remove duplicates:
    that.allowedFields = _.uniq(that.allowedFields);

    this.userInteraction = userInteraction;
    this.getData();
    this.onSelectionUpdate.notify({
      selectedFields: fields,
      allowedFields: that.allowedFields
    });
  };

  this.updateSelectedUnit = function(selectedUnit) {
    this.selectedUnit = selectedUnit;
    this.getData();
    this.onUnitsSelectedChanged.notify(selectedUnit);
  };

  this.getCombinationData = function(obj) {
    var getCombinations = function(fields, arr, n) {
      var index = 0, ret = [];
      for(var i = 0; i < arr.length; i++) {
        var elem = (n == 1) ? arr[i] : arr.shift();
        var field = (n == 1) ? fields[i] : fields.shift();
        for(var j = 0; j < elem.length; j++) {
          if(n == 1) {
            ret.push({
              value: elem[j],
              field: field
            });
          } else {
            var childperm = getCombinations(fields.slice(), arr.slice(), n-1);
            for(var k = 0; k < childperm.length; k++) {
              ret.push([{
                value: elem[j],
                field: field
              }].concat(childperm[k]));
            }
          }
        }
      }
      return ret;
    };

    var	loop = 1,
        res = [],
        src = JSON.parse(JSON.stringify(obj));

    for(; loop <= src.length; loop++) {
      obj = JSON.parse(JSON.stringify(src));
      res = res.concat(getCombinations(_.pluck(obj, 'field'), _.pluck(obj, 'values'), loop));
    }

    return _.map(res, function(r) {
      if(!_.isArray(r)) {
        r = [r];
      }
      return _.object(
        _.pluck(r, 'field'),
        _.pluck(r, 'value')
      );
    });
  };

  this.getData = function (initial) {
    // field: 'Grade'
    // values: ['A', 'B']
    var fields = this.selectedFields,
      selectedFieldTypes = _.pluck(fields, 'field'),
      datasets = [],
      that = this,
      seriesData = [],
      tableData = [],
      datasetIndex = 0,
      getCombinationDescription = function(combination) {
        return _.map(Object.keys(combination), function(key) {
          return combination[key];
          //return key + ' ' + combination[key];
        }).join(', ');
      },
      getColor = function(datasetIndex) {

        // offset if there is no headline data:
        if(!this.hasHeadline) {
          datasetIndex += 1;
        }

        if(datasetIndex === 0) {
          return headlineColor;
        } else {
          if(datasetIndex > colors.length) {
            return colors[datasetIndex - 1 - colors.length];
          } else {
            return colors[datasetIndex - 1];
          }
        }

        return datasetIndex === 0 ? headlineColor : colors[datasetIndex];
      },
      getBorderDash = function(datasetIndex) {

        // offset if there is no headline data:
        if(!this.hasHeadline) {
          datasetIndex += 1;
        }

        // 0 -
        // the first dataset is the headline:
        return datasetIndex > colors.length ? [5, 5] : undefined;
      },
      convertToDataset = function (data, combinationDescription /*field, fieldValue*/) {
        // var fieldIndex = field ? _.findIndex(that.selectedFields, function (f) {
        //     return f === field;
        //   }) : undefined,
        var fieldIndex,
          ds = _.extend({
            label: combinationDescription ? combinationDescription : that.country,
            borderColor: '#' + getColor(datasetIndex),
            backgroundColor: '#' + getColor(datasetIndex),
            pointBorderColor: '#' + getColor(datasetIndex),
            borderDash: getBorderDash(datasetIndex),
            data: _.map(that.years, function (year) {
              var found = _.findWhere(data, {
                Year: year
              });
              return found ? found.Value : null;
            }),
            borderWidth: combinationDescription ? 2 : 4
          }, that.datasetObject);
        datasetIndex++;
        return ds;
      };

    if (fields && !_.isArray(fields)) {
      fields = [].concat(fields);
    }

    var isSingleValueSelected = function() { return that.selectedFields.length === 1 && that.selectedFields[0].values.length === 1; },
        matchedData = that.data;

    // filter the data:
    //if(!isSingleValueSelected()) {
    if(that.selectedUnit) {
      matchedData = _.where(matchedData, { Units: that.selectedUnit});
    }

    matchedData = _.filter(matchedData, function(rowItem) {
      var matched = false;
      for(var fieldLoop = 0; fieldLoop < that.selectedFields.length; fieldLoop++) {
        if(that.selectedFields[fieldLoop].values.containsValue(rowItem[that.selectedFields[fieldLoop].field])) {
          matched = true;
          break;
        }
      }
      return matched;
    });

    //}
/*
    console.table(matchedData);

    // update statuses:
    _.each(that.fieldItemStates, function(fieldItemState) {
      var selectedInfo = _.findWhere(that.selectedFields, { field : fieldItemState.field });

      _.each(fieldItemState.values, function(fieldItemValue) {
        // nothing selected:
        if(!that.selectedFields.length) {
          fieldItemValue.state = 'default';
        } else {
          if(selectedInfo && selectedInfo.values.containsValue(fieldItemValue.value)) {
            fieldItemValue.state = 'selected';
          } else {
            // not selected, so is it in the data that we have?
            var uniqueMatchedFieldValues = _.chain(matchedData).pluck(fieldItemState.field).filter(function(x) { return x; }).uniq().value();

            if(uniqueMatchedFieldValues.containsValue(fieldItemValue.value) && selectedInfo) {
              fieldItemValue.state = 'possible'; // this field has a selection
            } else if(uniqueMatchedFieldValues.containsValue(fieldItemValue.value) && !selectedInfo) {
              fieldItemValue.state = 'default'; // no selections for this field, so set to default
            } else {

              // if(isSingleValueSelected() && that.selectedFields[0].field === fieldItemState.field) {
              //   fieldItemState.state = 'possible';
              // } else {
               // fieldItemValue.state = 'excluded';
              // }

              // isSingleValueSelected() &&
              fieldItemValue.state = that.selectedFields[0].field == fieldItemState.field ? 'possible' : 'excluded';
              //fieldItemValue.state = 'excluded';
            }
          }
        }
      });
    });

    // derive selection state ratios:
    var fieldSelectionInfo = this.fieldItemStates.map(function(fi) {
      var maxFieldValueCount = fi.values.length,
          fieldStates = _.pluck(fi.values, 'state');
      return {
        field: fi.field,
        fieldSelection: {
          possibleState: (_.filter(fieldStates, function(fv) { return fv === 'possible'; }).length / maxFieldValueCount) * 100,
          defaultState: (_.filter(fieldStates, function(fv) { return fv === 'default' || fv === 'selected'; }).length / maxFieldValueCount) * 100,
          excludedState: (_.filter(fieldStates, function(fv) { return fv === 'excluded'; }).length / maxFieldValueCount) * 100
        }
      };
    });
*/

    var fieldSelectionInfo = [];

    this.onFieldsStatusUpdated.notify({
      data: this.fieldItemStates,
      selectionStates: fieldSelectionInfo
    });

    // get the headline data:
    var headline = this.getHeadline();

    // all units for headline data:
    if(headline.length) {
      tableData.push({
        title: 'Headline data',
        headings: that.selectedUnit ? ['Year', 'Units', 'Value'] : ['Year', 'Value'],
        data: _.map(headline, function (d) {
          return that.selectedUnit ? [d.Year, d.Units, d.Value] : [d.Year, d.Value];
        })
      });
    }

    // headline plot should use the specific unit, if any,
    // but there may not be any headline data at all, or for the
    // specific unit:
    if(that.selectedUnit) {
      headline = _.where(headline, { Units : that.selectedUnit });
    }

    // only add to the datasets if there is any headline data:
    if(headline.length) {
      datasets.push(convertToDataset(headline));
    } else {
      this.hasHeadline = false;
    }

    // extract the possible combinations for the selected field values
    var combinations = this.getCombinationData(this.selectedFields);

    var filteredDatasets = [];
    /////////////////////////////////////////////////////////////////////////////////////////////////////////
    _.each(combinations, function(combination) {
      var filtered = _.filter(matchedData, function(dataItem) {
        var matched = true;
        for (var loop = 0; loop < that.selectableFields.length; loop++) {
          if (dataItem[that.selectableFields[loop]] !== combination[that.selectableFields[loop]])
            matched = false;
        }
        return matched;
      });

      if(filtered.length) {
        // but some combinations may not have any data:
        filteredDatasets.push({
          data: filtered,
          combinationDescription: getCombinationDescription(combination)
        });
      }
    });

    var datasetCountExceedsMax = false;
    // restrict count if it exceeds the limit:
    if(filteredDatasets.length > maxDatasetCount) {
      datasetCountExceedsMax = true;
      filteredDatasets = filteredDatasets.slice(0, maxDatasetCount);
    }

    _.chain(filteredDatasets)
      .sortBy(function(ds) { return ds.combinationDescription; })
      .each(function(ds) { datasets.push(convertToDataset(ds.data, ds.combinationDescription)); });

    /////////////////////////////////////////////////////////////////////////////////////////////////////////

    this.onDataComplete.notify({
      datasetCountExceedsMax: datasetCountExceedsMax,
      datasets: datasets,
      labels: this.years,
      tables: tableData,
      indicatorId: this.indicatorId,
      selectedUnit: this.selectedUnit
    });

    if (initial) {

      // order the fields based on the edge data, if any:
      if(this.edgesData.length) {
        var orderedEdges = _.chain(this.edgesData)
          .groupBy('From')
          .map(function(value, key) { return [key].concat(_.pluck(value, 'To')); })
          .flatten()
          .value();

        var customOrder = orderedEdges.concat(_.difference(_.pluck(this.fieldItemStates, 'field'), orderedEdges));

        // now order the fields:
        this.fieldItemStates = _.sortBy(this.fieldItemStates, function(item) {
          return customOrder.indexOf(item.field);
        });
      }

      this.onSeriesComplete.notify({
        series: this.fieldItemStates,
        allowedFields: this.allowedFields,
        edges: this.edgesData
      });
      this.onUnitsComplete.notify({
        units: this.units
      });
    } else {
      this.onSeriesSelectedChanged.notify({
        series: this.selectedFields
      });
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////
    if(initial && !this.hasHeadline) {
      // if there is no initial data, select some:
      this.onNoHeadlineData.notify();
    }
  };
};

indicatorModel.prototype = {
  initialise: function () {
    this.getData(true);
  },
  getData: function () {
    this.getData();
  }
};

var indicatorView = function (model, options) {

  "use strict";

  var view_obj = this;

  //this._fieldLimit = 2;
  this._model = model;

  this._chartInstance = undefined;
  this._rootElement = options.rootElement;

  var chartHeight = screen.height < options.maxChartHeight ? screen.height : options.maxChartHeight;

  $('.plot-container', this._rootElement).css('height', chartHeight + 'px');

  this._model.onDataComplete.attach(function (sender, args) {

    if(view_obj._model.showData) {

      $('#dataset-size-warning')[args.datasetCountExceedsMax ? 'show' : 'hide']();

      if(!view_obj._chartInstance) {
        view_obj.createPlot(args);
      } else {
        view_obj.updatePlot(args);
      }
    }

    view_obj.createTables(args);
  });

  this._model.onNoHeadlineData.attach(function() {
    $('#fields .variable-options :checkbox:eq(0)').trigger('click');
  });

  this._model.onSeriesComplete.attach(function (sender, args) {
    view_obj.initialiseSeries(args);
  });

  this._model.onSeriesSelectedChanged.attach(function (sender, args) {
    // var selector;
    // if (args.series.length === view_obj._fieldLimit) {
    //   selector = $('#fields input:not(:checked)');
    //   selector.attr('disabled', true);
    //   selector.parent().addClass('disabled').attr('title', 'Maximum of ' + view_obj._fieldLimit + ' selections; unselect another to select this field');
    // } else {
    //   selector = $('#fields input');
    //   selector.removeAttr('disabled');
    //   selector.parent().removeClass('disabled').removeAttr('title');
    // }
  });

  this._model.onUnitsComplete.attach(function(sender, args) {
    view_obj.initialiseUnits(args);
  });

  this._model.onUnitsSelectedChanged.attach(function(sender, args) {
    // update the plot's y axis label
    // update the data
  });

  this._model.onFieldsCleared.attach(function(sender, args) {
    $(view_obj._rootElement).find(':checkbox').prop('checked', false);
    $(view_obj._rootElement).find('#clear').addClass('disabled');

    // #246
    $(view_obj._rootElement).find('.selected').css('width', '0');
    // end of #246
  });

  this._model.onSelectionUpdate.attach(function(sender, args) {
    $(view_obj._rootElement).find('#clear')[args.selectedFields.length ? 'removeClass' : 'addClass']('disabled');

    // loop through the available fields:
    $('.variable-selector').each(function(index, element) {
      var currentField = $(element).data('field');

      // any info?
      var match = _.findWhere(args.selectedFields, { field : currentField });
      var element = $(view_obj._rootElement).find('.variable-selector[data-field="' + currentField + '"]');
      var width = match ? (Number(match.values.length / element.find('.variable-options label').length) * 100) + '%' : '0';

      $(element).find('.bar .selected').css('width', width);

      // is this an allowed field:
      $(element)[_.contains(args.allowedFields, currentField) ? 'removeClass' : 'addClass']('disallowed');
    });
  });

  this._model.onFieldsStatusUpdated.attach(function (sender, args) {
    //console.log('updating field states with: ', args);

    // reset:
    $(view_obj._rootElement).find('label').removeClass('selected possible excluded');

    _.each(args.data, function(fieldGroup) {
      _.each(fieldGroup.values, function(fieldItem) {
        var element = $(view_obj._rootElement).find(':checkbox[value="' + fieldItem.value + '"][data-field="' + fieldGroup.field + '"]');
        element.parent().addClass(fieldItem.state);
      });
    });

    _.each(args.selectionStates, function(ss) {
      // find the appropriate 'bar'
      var element = $(view_obj._rootElement).find('.variable-selector[data-field="' + ss.field + '"]');
      element.find('.bar .default').css('width', ss.fieldSelection.defaultState + '%');
      element.find('.bar .possible').css('width', ss.fieldSelection.possibleState + '%');
      element.find('.bar .excluded').css('width', ss.fieldSelection.excludedState + '%');
    });
  });

  $(document).click(function(e) {
    $('.variable-options').hide();
  });

  $(this._rootElement).on('click', '#clear', function() {
    view_obj._model.clearSelectedFields();
  });

  $(this._rootElement).on('click', '#fields label', function (e) {

    if(!$(this).closest('.variable-options').hasClass('disallowed')) {
      $(this).find(':checkbox').trigger('click');
    }

    e.preventDefault();
    e.stopPropagation();
  });

  $(this._rootElement).on('change', '#units input', function() {
    view_obj._model.updateSelectedUnit($(this).val());
  });

  // generic helper function, used by clear all/select all and individual checkbox changes:
  var updateWithSelectedFields = function() {
    view_obj._model.updateSelectedFields(_.chain(_.map($('#fields input:checked'), function (fieldValue) {
      return {
        value: $(fieldValue).val(),
        field: $(fieldValue).data('field')
      };
    })).groupBy('field').map(function(value, key) {
      return {
        field: key,
        values: _.pluck(value, 'value')
      };
    }).value(), {
      field: $(this).data('field'),
      value: $(this).val(),
      selected: $(this).is(':checked')
    });
  }

  $(this._rootElement).on('click', '.variable-options button', function(e) {
    var type = $(this).data('type');
    var $options = $(this).closest('.variable-options').find(':checkbox');

    $options.prop('checked', type == 'select');

    updateWithSelectedFields();

    e.stopPropagation();
  });

  $(this._rootElement).on('click', ':checkbox', function(e) {

    // don't permit excluded selections:
    if($(this).parent().hasClass('excluded') || $(this).closest('.variable-selector').hasClass('disallowed')) {
      return;
    }

    updateWithSelectedFields();

    e.stopPropagation();
  });

  $(this._rootElement).on('click', '.variable-selector', function(e) {

    var options = $(this).find('.variable-options');
    var optionsVisible = options.is(':visible');

    // ensure any others are hidden:
    $('.variable-options').hide();

    // but reinstate this one:
    $(options)[optionsVisible ? 'hide' : 'show']();

    e.stopPropagation();
  });

  this.initialiseSeries = function (args) {
    if(args.series.length) {
      var template = _.template($("#item_template").html());

        $('<button id="clear" class="disabled">Clear selections <i class="fa fa-remove"></i></button>').insertBefore('#fields');

        $('#fields').html(template({
            series: args.series,
            allowedFields: args.allowedFields,
            edges: args.edges
        }));
    } else {
      $(this._rootElement).addClass('no-series');
    }
  };

  this.initialiseUnits = function(args) {
    var template = _.template($('#units_template').html());

    $('#units').html(template({
      units: args.units || []
    }));
  };

  this.updatePlot = function(chartInfo) {
    view_obj._chartInstance.data.datasets = chartInfo.datasets;

    if(chartInfo.selectedUnit) {
      view_obj._chartInstance.options.scales.yAxes[0].scaleLabel.labelString = chartInfo.selectedUnit;
    }

    view_obj._chartInstance.update(1000, true);
  };

  this.createPlot = function (chartInfo) {

    var that = this;

    this._chartInstance = new Chart($(this._rootElement).find('canvas'), {
      type: this._model.graphType,
      data: chartInfo,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        spanGaps: true,
        scales: {
          xAxes: [{
            gridLines: {
              color: '#ddd',
            }
          }],
          yAxes: [{
            ticks: {
              suggestedMin: 0
            },
            scaleLabel: {
              display: this._model.selectedUnit ? this._model.selectedUnit : this._model.measurementUnit,
              labelString: this._model.selectedUnit ? this._model.selectedUnit : this._model.measurementUnit
            }
          }]
        },
        layout: {
          padding: {
            top: 20,
            // default of 85, but do a rough line count based on 150 characters per line * 20 pixels per
            // row
            bottom: that._model.footnote ? (20 * (that._model.footnote.length / 150)) + 85 : 85
          }
        },
        legend: {
          display: true,
          usePointStyle: false,
          position: 'bottom',
          padding: 20
        },
        title: {
          fontSize: 18,
          fontStyle: 'normal',
          display: this._model.chartTitle,
          text: this._model.chartTitle,
          padding: 20
        },
        plugins: {
          scaler: {}
        }
      }
    });

    Chart.pluginService.register({
      afterDraw: function(chart) {
        var $canvas = $(that._rootElement).find('canvas'),
            font = '12px Arial',
            canvas = $canvas.get(0),
            textRowHeight = 20,
            ctx = canvas.getContext("2d");

            ctx.font = font;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = '#6e6e6e';

            var getLinesFromText = function(text) {
              var width = parseInt($canvas.css('width')), //width(),
                  lines = [],
                  line = '',
                  lineTest = '',
                  words = text.split(' ');

              for (var i = 0, len = words.length; i < len; i++) {
                lineTest = line + words[i] + ' ';

                // Check total width of line or last word
                if (ctx.measureText(lineTest).width > width) {
                  // Record and reset the current line
                  lines.push(line);
                  line = words[i] + ' ';
                } else {
                  line = lineTest;
                }
              }

              // catch left overs:
              if (line.length > 0) {
                lines.push(line.trim());
              }

              return lines;
            };

        function putTextOutputs(textOutputs, x) {
          var y = $canvas.height() - 10 - ((textOutputs.length - 1) * textRowHeight);

          _.each(textOutputs, function(textOutput) {
            ctx.fillText(textOutput, x, y);
            y += textRowHeight;
          });
        }

        var graphFooterItems = [
          'Source: ' + (that._model.dataSource ? that._model.dataSource : ''),
          'Geographical Area: ' + (that._model.geographicalArea ? that._model.geographicalArea : ''),
          'Unit of Measurement: ' + (that._model.measurementUnit ? that._model.measurementUnit : '')
        ];

        if(that._model.footnote) {
          var footnoteRows = getLinesFromText('Footnote: ' + that._model.footnote);
          graphFooterItems = graphFooterItems.concat(footnoteRows);

          if(footnoteRows.length > 1) {
            //that._chartInstance.options.layout.padding.bottom += textRowHeight * footnoteRows.length;
            that._chartInstance.resize(parseInt($canvas.css('width')), parseInt($canvas.css('height')) + textRowHeight * footnoteRows.length);
            that._chartInstance.resize();
          }
        }

        putTextOutputs(graphFooterItems, 0);
      }
    });
  };

  this.toCsv = function (tableData) {
    var lines = [],
    headings = tableData.headings;

    lines.push(headings.join(','));

    _.each(tableData.data, function (dataValues) {
      var line = [];

      _.each(headings, function (heading, index) {
        line.push(dataValues[index]);
      });

      lines.push(line.join(','));
    });

    return lines.join('\n');
  };

  this.createTables = function (chartInfo) {

    options = options || {};
    var that = this,
    csv_path = options.csv_path,
    el = options.element || '#datatables',
    allow_download = options.allow_download || false,
    csv_options = options.csv_options || {
      separator: ',',
      delimiter: '"'
    },
    datatables_options = options.datatables_options || {
      paging: false,
      bInfo: false,
      searching: false/*,
      scrollX: true,
      sScrollXInner: '100%',
      sScrollX: '100%'*/
    },
    table_class = options.table_class || 'table table-hover';

    // clear:
    $(el).html('');

    // loop through chartInfo.
    chartInfo.tables.forEach(function (tableData, index) {

//        if(window.Modernizr && window.Modernizr.blobconstructor) {
          $(el).append($('<a />').text('Download headline CSV')
          .attr({
            'href': URL.createObjectURL(new Blob([that.toCsv(tableData)], {
              type: 'text/csv'
            })),
            'download': chartInfo.indicatorId + tableData.title + '.csv',
            'title': 'Download as CSV',
            'class': 'btn btn-primary btn-download',
						'tabindex': 0
          })
          .data('csvdata', that.toCsv(tableData)));
//        }

      $(el).append($('<h4 />').text(tableData.title));

      if (tableData.data.length) {
        var currentId = 'indicatortable' + index;

        var currentTable = $('<table />').attr({
          'class': 'table-responsive ' + table_class,
          'id': currentId
        });

				currentTable.append('<caption>' + that._model.chartTitle + '</caption>');

        var table_head = '<thead><tr>';

        tableData.headings.forEach(function (heading) {
          table_head += '<th>' + heading + '</th>';
        });

        table_head += '</tr></thead>';
        currentTable.append(table_head);
        currentTable.append('<tbody></tbody>');

        tableData.data.forEach(function (data) {
          var row_html = '<tr>';
          tableData.headings.forEach(function (heading, index) {
            row_html += '<td>' + (data[index] ? data[index] : '-') + '</td>';
          });
          row_html += '</tr>';
          currentTable.find('tbody').append(row_html);
        });

        $(el).append(currentTable);

        // equal width columns:
        datatables_options.aoColumns = _.map(tableData.headings, function (h) {
          return {
            sWidth: (100 / tableData.headings.length) + '%'
          };
        });
        datatables_options.aaSorting = [];

        currentTable.DataTable(datatables_options);

      } else {
        $(el).append($('<p />').text('There is no data for this breakdown.'));
      }

      $(el).append('<hr />');
    });
  };
};

var indicatorController = function (model, view) {
  this._model = model;
  this._view = view;
};

indicatorController.prototype = {
  initialise: function () {
    this._model.initialise();
  }
};

var indicatorSearch = function(inputElement, indicatorDataStore) {
  that = this;
  this.inputElement = inputElement;
  this.indicatorDataStore = indicatorDataStore;
  this.indicatorData = [];
  this.hasErrored = false;

  this.processData = function(data) {
    for(var goalLoop = 0; goalLoop < data.length; goalLoop++) {
      for(var indicatorLoop = 0; indicatorLoop < data[goalLoop].goal.indicators.length; indicatorLoop++) {
        var currentIndicator = data[goalLoop].goal.indicators[indicatorLoop];
        currentIndicator.goalId = data[goalLoop].goal.id;
        currentIndicator.goalTitle = data[goalLoop].goal.title;
        that.indicatorData.push(currentIndicator);
      }
    }
  };

  this.inputElement.keyup(function(e) {
    var searchValue = that.inputElement.val();
    if(e.keyCode === 13 && searchValue.length) {
      window.location.replace(that.inputElement.data('pageurl') + searchValue);
    }
  });

  var escapeRegExp = function(str) {
    return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/gi, "\\$&");
  };

  if($('#main-content').hasClass('search-results')) {
        
    var results = [],
        that = this,
        searchString = unescape(location.search.substring(1));

    // we got here because of a redirect, so reinstate:
    this.inputElement.val(searchString);

    $('#main-content h1 span').text(searchString);
    $('#main-content h1').show();
  
    //this.getData().then(function() {
    this.indicatorDataStore.getData().then(function(data) {

      that.processData(data);

      var searchResults = _.filter(that.indicatorData, function(indicator) {
        return indicator.title.toLowerCase().indexOf(searchString.toLowerCase()) != -1; 
      });

      // goal
      //    indicators
      // goal
      //    indicators    

      _.each(searchResults, function(result) {
        var goal = _.findWhere(results, { goalId: result.goalId }),
            indicator = {
              parsedTitle: result.title.replace(new RegExp('(' + escapeRegExp(searchString) + ')', 'gi'), '<span class="match">$1</span>'),
              id: result.id,
              title: result.title,
              href: result.href,
            };

        if(!goal) {
          results.push({
            goalId: result.goalId,
            goalTitle: result.goalTitle,
            indicators: [indicator]
          });
        } else {
          goal.indicators.push(indicator);
        }
      });

      $('.loader').hide();

      var template = _.template(
        $("script.results").html()
      );

      $('div.results').html(template({
        searchResults: results,
        resultsCount: searchResults.length,
        imgPath: $('.results').data('imgpath')
      }));
    });
  }
};

indicatorSearch.prototype = {

};

$(function() {
  $('#main-nav').append('<div id="search" class="menu-target"><label for="indicator_search"><i class="fa fa-search" aria-hidden="true"></i><span>Search:</span></label><input id="indicator_search" title="Indicator search" placeholder="Indicator search" data-url="/indicators.json" data-pageurl="/search/?" /></div>');
  var $el = $('#indicator_search');
  new indicatorSearch($el, new indicatorDataStore($el.data('url')));
});


var reportingStatus = function(indicatorDataStore) {
  this.indicatorDataStore = indicatorDataStore;

  this.getReportingStatus = function() {

    var that = this;

    return new Promise(function(resolve, reject) {

      // if(Modernizr.localStorage &&) {

      // }

      getPercentages = function(values) {

        var percentageTotal = 100;
        var total = _.reduce(values, function(memo, num) { return memo + num; });
        var percentages = _.map(values, function(v) { return (v / total) * percentageTotal; });

        var off = percentageTotal - _.reduce(percentages, function(acc, x) { return acc + Math.round(x) }, 0);
          return _.chain(percentages).
                  map(function(x, i) { return Math.round(x) + (off > i) - (i >= (percentages.length + off)) }).
                  value();
      }

      that.indicatorDataStore.getData().then(function(data) {
        // for each goal, get a percentage of indicators in the various states:
        // notstarted, inprogress, complete
        var mappedData = _.map(data, function(dataItem) {

          var returnItem = {
            goal_id: dataItem.goal.id,
            notStartedCount: _.where(dataItem.goal.indicators, { status: 'notstarted' }).length,
            inProgressCount: _.where(dataItem.goal.indicators, { status: 'inprogress' }).length,
            completeCount: _.where(dataItem.goal.indicators, { status: 'complete' }).length
          };

          returnItem.totalCount = returnItem.notStartedCount + returnItem.inProgressCount + returnItem.completeCount;
          returnItem.counts = [returnItem.notStartedCount, returnItem.inProgressCount, returnItem.completeCount];
          returnItem.percentages = getPercentages([returnItem.notStartedCount, returnItem.inProgressCount, returnItem.completeCount]);          
          
          return returnItem;
        });    

        var getTotalByStatus = function(statusType) {
          return _.chain(mappedData).pluck(statusType).reduce(function(sum, n) { return sum + n; }).value();          
        };

        var overall = {
          totalCount: _.chain(mappedData).pluck('totalCount').reduce(function(sum, n) { return sum + n; }).value(),
          counts: [
            getTotalByStatus('notStartedCount'),
            getTotalByStatus('inProgressCount'),
            getTotalByStatus('completeCount')
          ]
        };

        overall.percentages = getPercentages([overall.counts[0], overall.counts[1], overall.counts[2]]);          
        
        resolve({
          goals: mappedData,
          overall: overall
        });
      });     
    });
  };
};

$(function() {

  if($('.container').hasClass('reportingstatus')) {
    var url = $('.container.reportingstatus').attr('data-url'),
        status = new reportingStatus(new indicatorDataStore(url)),
        types = ['Exploring data sources', 'Statistics in progress', 'Reported online'],
        bindData = function(el, data) {
          $(el).find('.goal-stats span').each(function(index, statEl) {
            var percentage = Math.round(Number(((data.counts[index] / data.totalCount) * 100))) + '%';
            
            $(statEl).attr({
              'style': 'width:' + data.percentages[index] + '%',
              'title': types[index] + ': ' + data.percentages[index] + '%'
            });
  
            $(el).find('span.value:eq(' + index + ')').text(data.percentages[index] + '%');
          }); 
        };

    status.getReportingStatus().then(function(data) {
      bindData($('.goal-overall'), data.overall);
      _.each(data.goals, function(goal) {
        var el = $('.goal[data-goalid="' + goal.goal_id + '"]');
        bindData(el, goal);       
      });
    });
  }
});

$(function() {

  var topLevelSearchLink = $('.top-level a:eq(1)');

  var resetForSmallerViewport = function() {
    topLevelSearchLink.text('Search');
    $('.top-level li').removeClass('active');
    $('.top-level a').removeClass('open');
  };  

  $('.top-level span').click(function() {
    var target = $(this).data('target');

    $('.top-level li').removeClass('active');
    topLevelSearchLink.text('Search');

    var targetEl = $('#' + target);
    var wasVisible = targetEl.is(':visible');

    // hide everything:
    $('.menu-target').hide();

    if(target === 'search') {
      $(this).toggleClass('open');
      
      if($(this).hasClass('open') || !wasVisible) {
        $(this).text('Hide');
      } else {
        $(this).text('Search');
      }
    }

    if(!wasVisible) {
      targetEl.show();
      $(this).parent().addClass('active');
    }
  });

  $(window).on('resize', function(e) {
    var viewportWidth = window.innerWidth,
        previousWidth = $('body').data('vwidth'),
        breakpointWidth = 768;

    if(viewportWidth > breakpointWidth && previousWidth <= breakpointWidth) {
      // switched to larger viewport:
      $('.menu-target').show();
    } else if(previousWidth >= breakpointWidth && viewportWidth < breakpointWidth) {
      // switched to smaller viewport:
      $('.menu-target').hide();
      resetForSmallerViewport();
    }

    // update the viewport width:
    $('body').data('vwidth', viewportWidth);
  });
});
