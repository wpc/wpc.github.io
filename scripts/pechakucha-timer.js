'use strict';

(function() {

    var start = new Date().getTime();
    var tickTimeout = null;

    var formatNumTh = function(num) {
      switch (10 <= num && num <= 19 ? 10 : num % 10) {
      case 1: num += "st"; break;
      case 2: num += "nd"; break;
      case 3: num += "rd"; break;
      default: num += "th"; break;
      }
      return num;
    }

    var color = d3.scale.linear()
      .range(["hsl(-180,60%,50%)", "hsl(180,60%,50%)"])
      .interpolate(function(a, b) { var i = d3.interpolateString(a, b); return function(t) { return d3.hsl(i(t)); }; });

  var render = function() {
    var canvas = document.getElementById("canvas");
    var width = canvas.offsetWidth,
    height = canvas.offsetHeight,
    radius = Math.min(width, height) / 1.5,
    spacing = .09;

    var arcBody = d3.svg.arc()
      .startAngle(0)
      .endAngle(function(d) { return d.value * 2 * Math.PI; })
      .innerRadius(function(d) { return d.index * radius; })
      .outerRadius(function(d) { return (d.index + spacing) * radius; })
      .cornerRadius(6);

    var arcCenter = d3.svg.arc()
      .startAngle(0)
      .endAngle(function(d) { return d.value * 2 * Math.PI; })
      .innerRadius(function(d) { return (d.index + spacing / 2) * radius; })
      .outerRadius(function(d) { return (d.index + spacing / 2) * radius; });

    var svg = d3.select(canvas).selectAll("svg").data([null]);
    svg.enter().append("svg");
    svg.attr("width", width)
      .attr("height", height);

    var inner = svg.selectAll("g.inner").data([null])
    inner.enter()
      .append("g")
      .attr("class", "inner");

    inner.attr("transform", "translate(" + width / 2 + "," + height / 2 + ")");

    var field = inner.selectAll("g.field")
      .data(fields, function(d) { return d.index; });

    field.enter()
      .append("g")
      .attr("class", "field")
      .call(function(parent) {
        parent.append("path")
          .attr("class", "arc-body");

        parent.append("path")
          .attr("id", function(d, i) { return "arc-center-" + i; })
          .attr("class", "arc-center");

        parent.append("text")
          .attr("dy", ".35em")
          .attr("dx", ".75em")
          .style("text-anchor", "start")
          .append("textPath")
          .attr("startOffset", "50%")
          .attr("class", "arc-text")
          .attr("xlink:href", function(d, i) { return "#arc-center-" + i; });
      });
    if(tickTimeout) {
      clearTimeout(tickTimeout);
    }

    tick();

    function tick() {
      if (!document.hidden) field
        .each(function(d) { this._value = d.value; })
          .data(fields)
        .each(function(d) { d.previousValue = this._value; })
          .transition()
        .ease("elastic")
        .duration(500)
        .each(fieldTransition);

      tickTimeout = setTimeout(tick, 100);
    }

    function fieldTransition() {
      var field = d3.select(this).transition();

      field.select(".arc-body")
        .attrTween("d", arcTween(arcBody))
        .style("fill", function(d) { return color(d.value); });

      field.select(".arc-center")
        .attrTween("d", arcTween(arcCenter));

      field.select(".arc-text")
        .text(function(d) { return d.text; });
    }

    function arcTween(arc) {
      return function(d) {
        var i = d3.interpolateNumber(d.previousValue, d.value);
        return function(t) {
          d.value = i(t);
          return arc(d);
        };
      };
    }

    function fields() {
      var elapsed = (new Date().getTime() - start) / 1000;
      var seconds = elapsed % 20;
      var thSlides = Math.floor(elapsed / 20);
      return [
        {index: .3, text: Math.floor(seconds) + " seconds", value: seconds / 20 },
        {index: .1, text: formatNumTh(thSlides) + " slides", value: thSlides / 20}
      ];
    }
  };

  window.onresize = render;
  render();

  document.onclick = function() {
    start = new Date().getTime();
  };
})();
