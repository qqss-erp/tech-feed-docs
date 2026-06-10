---
sidebar_position: 1
title: OEE Configuration
---

# OEE Configuration

This document explains the technical configuration and extension model for the OEE Dashboard in the frontend application.

## Module Paths

In `dmex-dashboard` repository:

- Frontend OEE page: `src/app/dashboard/pages/oee-dashboard`
- Shared global helpers: `src/app/shared/gobal.ts`
- OEE-specific report config service: `src/app/dashboard/pages/oee-dashboard/oee-report-config.service.ts`
- Chart model and adapter:
  - `src/app/charts/models/chart-types.ts`
  - `src/app/charts/services/echarts-adapter.service.ts`
- Data service: `src/app/services/chart-data.service.ts`
- Environments:
  - `src/environments/environment.ts`
  - `src/environments/environment.prod.ts`

## Architecture Overview

The OEE dashboard uses a reusable chart architecture with:

1. Report metadata in `oee-report-config.service.ts` (`OEE_REPORTS`)
2. Runtime report loading in `oee-dashboard.component.ts`
3. Shared chart spec builder (`buildChartSpec`)
4. ECharts option generation via `EChartsAdapterService`

Primary design goals:

- Backend-driven data usage
- Minimal frontend transformation
- Reusable report loading patterns
- Shared utility-first implementation

## OEE Report Metadata (`OEE_REPORTS`)

Reports are defined in `oee-report-config.service.ts` using `OeeReportMeta`.

Each report contains:

- `key`: unique report id
- `title`: UI title
- `categoryType`: `machine` or `operator`
- `defaultRangeDays`: default range used on report activation
- `yLabel`: Y-axis label
- `xLabel`: X-axis label
- `supportsPartStatus` (optional)
- `secondarySeriesName` (optional, for IoT/secondary series)

## Chart Loading Flow

In `oee-dashboard.component.ts`, loading is split into reusable methods:

- `loadMonthWise()`
- `loadDayWise()`
- `loadMachineWise()`
- `loadOperatorWise()`
- `loadProductionCountWise()`

Common flow:

1. Resolve active report from route/tab
2. Build query state from filter form
3. Try cache (`reportDataCache`)
4. Execute request using shared request lifecycle
5. Extract rows using shared extractors
6. Build chart spec using shared chart helpers
7. Render via `<dmex-chart-renderer [spec]="activeSpec">`

## Shared Utilities Used

Implemented from `gobal.ts` for reuse across modules:

- `extractRows()`
- `buildChartSpec()`
- `resolveField()`
- `resolveNumber()`
- `mapChartSeries()`
- `formatLocalDateTime()`
- `parseLocalDateTime()`
- `toNumberArray()`
- `getCachedValue()`
- `resolveMachineIds()`
- `getSourceValue()`
- `getSourceLabel()`

## Threshold-Based OEE Color Logic

For OEE bar charts, bars are colorized against `oeePassThreshold` values from environment:

- `passColor` when value is above/equal threshold
- `failColor` when value is below threshold

Environment keys:

```ts
environment.oeeChart.passThreshold
environment.oeeChart.passColor
environment.oeeChart.failColor
environment.oeeChart.iotPassColor
environment.oeeChart.iotFailColor
```

## Table and Breakup Support

Existing functional modules retained:

- Operator-wise breakup
- Operator with idle-time breakup
- Machine-wise breakup
- Day-wise breakup
- Month-wise breakup
- Day-wise production count breakup

All use shared request/cache lifecycle methods to avoid duplication.

## Export Architecture

Excel export logic is centralized in:

- `src/app/services/export-excel.service.ts` (in `dmex-dashboard`)

Shared models/interfaces are in `gobal.ts`:

- `ExportColumn`
- `ExportSheetConfig`
- `ExportFileConfig`

Common formatting helpers:

- `formatExportDate()`
- `formatExportNumber()`
- `formatExportPercentage()`
- `formatExportNullable()`

## How to Add a New OEE Report

1. Add a new metadata object in `OEE_REPORTS` (in `oee-report-config.service.ts`).
2. Add API request mapping in `buildChartRequest()`.
3. Add report handler in `loadActiveReport()`.
4. Add chart label mapping in `getChartLabelKeys()`.
5. If table mode required, add breakup loader + template section.
6. Add export columns/sheets using `ExportExcelService`.

## Add Fully New OEE Chart (End-to-End)

Use this when you are adding a brand-new chart/report type in OEE (new tab + new API + new rendering).

### 1) Define report metadata

File: `src/app/dashboard/pages/oee-dashboard/oee-report-config.service.ts`

Add a new object in `OEE_REPORTS`:

```ts
{
  key: 'shiftWiseOee',
  title: 'Shift Wise OEE',
  categoryType: 'machine',
  defaultRangeDays: 30,
  yLabel: 'OEE %',
  xLabel: 'Shift',
  secondarySeriesName: 'IoT %'
}
```

### 2) Add backend API method in chart service

File: `src/app/services/chart-data.service.ts`

Add a fetch method for the new report endpoint (keep API contracts as backend provides).

Example:

```ts
fetchShiftWiseOeeReport(fromTime: number, toTime: number, categoryId: number[], includeIotData: boolean) {
  return this.http.post(...);
}
```

### 3) Wire request mapping

File: `src/app/dashboard/pages/oee-dashboard/oee-dashboard.component.ts`

Inside `buildChartRequest()` add:

```ts
shiftWiseOee: () =>
  this.chartData.fetchShiftWiseOeeReport(fromTime, toTime, categoryId, this.includeIotData),
```

### 4) Add report load handler

In `loadActiveReport()` add route handling for new key:

- Chart mode: call `loadChartReport(...)` through a dedicated wrapper method (recommended).
- Table mode: if needed, add breakup loader path.

Recommended wrapper:

```ts
private loadShiftWise(queryState: ReportQueryState, preferCache: boolean): void {
  this.loadChartReport(
    'shiftWiseOee',
    queryState,
    preferCache,
    this.buildChartRequest('shiftWiseOee', queryState),
  );
}
```

### 5) Map label/value fields

Update `getChartLabelKeys(reportKey)` so chart labels resolve correctly:

```ts
case 'shiftWiseOee':
  return ['shiftName', 'shift', 'label'];
```

If backend uses different value keys, update `buildSpec()` value key resolution for this report.

### 6) Add table view support (optional)

If table/breakup is needed:

1. Add `isShiftWiseReport()` getter.
2. Include it in `isTableSupportedReport`.
3. Add table loader + cache key builder.
4. Add table section in `oee-dashboard.component.html`.

### 7) Add export support

Use centralized export service only:

```ts
this.exportExcelService.exportToExcel(...)
```

Define report-specific export columns and sheet config; keep formatting via shared helpers in `gobal.ts`.

### 8) Validate behavior

Run:

```bash
npx tsc -p tsconfig.app.json --noEmit
```

Then verify:

1. Tab is visible and selectable.
2. Filter + refresh fetch correct data.
3. Chart renders with expected labels/values.
4. IoT secondary series works when enabled.
5. Table/breakup/popup/export work (if applicable).
6. Live refresh and cache behavior are unchanged.

## Performance and Maintainability Notes

- Prefer shared helpers over inline parsing/mapping
- Reuse cache + request lifecycle methods
- Keep API response usage direct where possible
- Avoid report-specific duplicated logic
- Keep chart and export logic centralized

## Validation Checklist

After OEE changes:

1. Run type-check:
   - `npx tsc -p tsconfig.app.json --noEmit`
2. Validate chart mode and table mode for each report.
3. Validate IoT toggle behavior.
4. Validate breakups, popups, exports, and refresh flow.
5. Verify legend/tooltip consistency for threshold-colored bars.
