'use strict';
// Construct the historical v1 representation explicitly. Production capture now
// emits v2; legacy validation and comparison regression tests must keep testing v1.
const {deriveHandlerAssociations}=require('../../packages/cli/src/internal/report/handler-associations');
module.exports = analytics => {
  const value=structuredClone(analytics), result=deriveHandlerAssociations(value);
  value.version='pulse.report-analytics.v1';value.associations=result.rows;value.coverage.associations=result.coverage;
  return value;
};
