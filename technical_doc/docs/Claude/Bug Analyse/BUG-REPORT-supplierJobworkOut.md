# UI / Functional Review — Bug Report

**Modules reviewed**

| # | Module | Route | Primary source |
|---|--------|-------|----------------|
| 1 | Supplier Jobwork Out | `layout/supplierJobworkOut` | `poweb/src/app/layout/dc/supplier-jobwork-out/**` |

**Method** — static source review of the Angular components, templates, shared services, routing, and the backing NestJS endpoints (`procurementsvcs`). Every finding below cites the file and line that produces it.

---

## 1. Cross-cutting issues (span multiple screens / shared services)

> The XC items below also affect Supplier Jobwork In; they are recorded in both reports so each can be triaged independently.

### XC-001 · Cross-cutting · Search + List (all screens) · **Critical** · **P1** · Search & fetch endpoints are `@Public()` — unauthenticated data exposure
**Description:** Both list endpoints are annotated `@Public()`, which bypasses the controller's `@Asset('SUPPLIER-JOB-WORK-OUT')` auth guard. `supplier-jobwork-out.controller.ts:65-66` (`@Public() @Get("search/:exactMatch?")`) and `:115-116` (`@Public() @Get("fetch/:exactMatch?")`). Any anonymous caller can enumerate all supplier DC/jobwork data (dcNumber, supplier, dates, vehicle) across tenants that resolve through the header.
**Preconditions:** Service reachable on the network.
**Steps to Reproduce:** 1) `GET {procurementsvcs}/supplierjobworkout/fetch/false?dcDate=2020-01-01` with no auth token. 2) Observe data returned.
**Actual Result:** Data returned without authentication/authorization.
**Expected Result:** Endpoint enforces auth + `SUPPLIER-JOB-WORK-OUT` asset/read permission.
**Root Cause (Possible):** `@Public()` left on from prototyping.
**Suggested Fix:** Remove `@Public()`; rely on `@Asset(...)` + a READ action check. If pagination pre-auth is truly needed, add an explicit read guard.
**Regression Areas:** Any consumer relying on unauthenticated fetch; e-way-bill JSON, PDF generation (already auth'd).
**Screenshots Required:** No · **API Affected:** `GET supplierjobworkout/search/:exactMatch?`, `GET supplierjobworkout/fetch/:exactMatch?`

### XC-002 · Cross-cutting · Edit (cancel/delete) · **High** · **P1** · SQL injection via string-interpolated `id` in raw queries
**Description:** `supplier-jobwork-out.service.ts:1782` builds a raw `.where()` clause using the request body value for `supplierDcOut.id`. `id` arrives from `@Body()` (`cancelById`, controller `:147`) and is not validated as numeric. Comparable interpolation exists in the In service (see `BUG-REPORT-supplierJobworkIn.md` XC-002). A crafted body `{"id":"1 OR 1=1"}` alters the query.
**Preconditions:** Authenticated user who can reach cancel.
**Steps to Reproduce:** 1) `POST supplierjobworkout/cancelById` with `id` = `"0 OR 1=1"`. 2) Observe query executes against injected predicate.
**Actual Result:** User-controlled string concatenated into SQL.
**Expected Result:** Parameterized query (`:id`) with `ParseIntPipe`/DTO validation.
**Root Cause (Possible):** Manual query string concatenation.
**Suggested Fix:** `.where('supplierJobWorkOutId = :id', { id: Number(supplierDcOut.id) })` and validate `id` with a DTO/`ParseIntPipe`.
**Regression Areas:** Cancel flow, audit logging.
**Screenshots Required:** No · **API Affected:** `POST supplierjobworkout/cancelById`

### XC-003 · Cross-cutting · Search/Edit · **High** · **P2** · Service observables swallow HTTP errors (`Observable.create` with no error handler)
**Description:** Almost every method in `supplier-jobworkout.service.ts` wraps `http.get(...).subscribe(data => {...})` inside `Observable.create` with **no error callback** — e.g. `fetchSupplierJobWorkOutById:37-47`, `searchSupplierJobWorkOut:123-133`, `fetchSupplierJobWorkOut:224-234`, `searchJobOrder:159-179`, `fetchJobOrderById:181-191`. On HTTP failure the inner subscription errors, the outer observer never emits `next`/`error`/`complete`, so callers hang. Several component callers show a loader (`appComponent.loader(true)`) that then never turns off (e.g. search `getDataFromService`, edit `retrieveSupplierJobWorkOutScreen`).
**Preconditions:** Backend returns 4xx/5xx or network drops.
**Steps to Reproduce:** 1) Trigger a search while backend down. 2) Loader spins indefinitely; no toast.
**Actual Result:** Silent hang, stuck loader.
**Expected Result:** Error surfaced (toast) and loader dismissed.
**Root Cause (Possible):** Legacy `Observable.create` pattern instead of returning `http.get(...)` directly.
**Suggested Fix:** Return the `HttpClient` observable directly (`return this.http.get(...)`) and let components use `error` callbacks (many already pass one that currently never fires), or forward errors: `.subscribe({next, error: e => observer.error(e)})`.
**Regression Areas:** All search/fetch/save flows in both modules.
**Screenshots Required:** No · **API Affected:** All GET wrappers in the service.

### XC-004 · Cross-cutting · Edit · **Medium** · **P2** · No DB transaction around multi-entity create/save
**Description:** `supplier-jobwork-out.service.ts:create()` (`:101`) performs sequential independent saves — header (`entityManager.save(entity):138`), auto-number update, RM line items (`:181`), expected line items (`:182`), serial numbers (`:201`), exception lines (`:202`), mail, and stock ledger (`:212`) — **without a transaction/QueryRunner wrapping them**. A failure after the header save (e.g. serial save throws) leaves a persisted DC header with missing/partial children and an inconsistent stock ledger.
**Preconditions:** Any mid-flow failure (constraint, downstream API).
**Steps to Reproduce:** 1) Force `saveSupplierJobworkOutExpectedLineItemXSerialNumbers` to throw. 2) DC header remains saved without serial rows.
**Actual Result:** Partial write / orphaned header.
**Expected Result:** All-or-nothing via transaction; rollback on failure.
**Root Cause (Possible):** Saves not wrapped in `entityManager.transaction(...)`.
**Suggested Fix:** Wrap the create body in `entityManager.transaction()` (or a shared `QueryRunner`) and roll back on error. The serial-lock QueryRunner already exists and could host the transaction.
**Regression Areas:** Create/edit persistence, stock ledger accuracy.
**Screenshots Required:** No · **API Affected:** `POST supplierjobworkout/create`

### XC-005 · Cross-cutting · Edit/Search · **Medium** · **P2** · Numeric inputs accept negative values (no `min`)
**Description:** Quantity/percentage `<input type="number">` fields have no `min="0"` and no reactive validators: RM Quantity `supplier-jobwork-out-edit.component.html:247`, Expected Quantity `:379`, IGST/CGST/SGST `:170,178,186`. Negative quantities/percentages pass client validation and reach the server (which likewise does not reject them in the reviewed paths).
**Preconditions:** User types `-5`.
**Steps to Reproduce:** 1) Enter `-5` in RM Quantity, Add. 2) Line item accepted.
**Actual Result:** Negative qty stored, corrupts stock ledger / costing totals.
**Expected Result:** Reject values < 0 (and enforce decimals policy).
**Root Cause (Possible):** Missing `min` + `Validators.min(0)`.
**Suggested Fix:** Add `min="0"` and `Validators.min(0)`; server-side guard on qty/gst.
**Regression Areas:** Stock ledger, grand-total, RM validation.
**Screenshots Required:** No · **API Affected:** `POST supplierjobworkout/create`

### XC-006 · Cross-cutting · All screens · **Low** · **P3** · Full-page reload used for navigation (`window.location.reload()`)
**Description:** After save/cancel and on "Cancel/Back", the app does `this.router.navigateByUrl(...)` immediately followed by `window.location.reload()` (`supplier-jobwork-out-edit.component.ts:898-899, 1990, back():1824`). This defeats SPA routing, re-bootstraps Angular, refetches everything, and loses transient state — noticeable latency on large tenants.
**Preconditions:** Any save/cancel/back.
**Steps to Reproduce:** 1) Save a DC. 2) Whole app reloads.
**Actual Result:** Hard reload.
**Expected Result:** SPA navigation / component reset.
**Root Cause (Possible):** Workaround for stale component state.
**Suggested Fix:** Reset form/state and navigate without `location.reload()`.
**Regression Areas:** Post-save UX across module.
**Screenshots Required:** No · **API Affected:** None

### XC-007 · Cross-cutting · Edit · **Medium** · **P2** · HTML built from DB strings injected via `innerHTML` (potential stored XSS)
**Description:** `generateProcessGroupTable()` concatenates process/part names into an HTML string that is bound with `[innerHTML]` (`supplier-jobwork-out-edit.component.html:511`), and `validateRawMaterials()` builds a `<table>` string from part `number`/`name` shown in a confirmation dialog (`supplier-jobwork-out-edit.component.ts:260-278`). If any part/process name contains markup, it renders unsanitized.
**Preconditions:** A part/process name containing HTML/script.
**Steps to Reproduce:** 1) Name a part `<img src=x onerror=alert(1)>`. 2) Open a DC referencing it.
**Actual Result:** Markup interpreted.
**Expected Result:** Values escaped or rendered via bound template, not string concatenation.
**Root Cause (Possible):** Manual HTML string building.
**Suggested Fix:** Render tables with Angular template rows (`*ngFor`) instead of `innerHTML`; if HTML is unavoidable, sanitize via `DomSanitizer`.
**Regression Areas:** Line-item table, RM validation dialog.
**Screenshots Required:** No · **API Affected:** None

---

## 2. Findings by category

### A. Page layout & responsiveness

#### SJWO-001 · SupplierJobworkOut · Edit · **Low** · **P3** · No responsive breakpoints in edit stylesheet
**Description:** `supplier-jobwork-out-edit.component.css` (421 lines) contains **zero `@media` queries** (verified: no matches). The edit form uses a dense `col-md-*` grid plus wide tables (RM, expected line items with serial chips). On < md widths columns stack unpredictably and the serial/process tables overflow relying only on `.table-responsive`.
**Preconditions:** Viewport < ~768px or zoom.
**Steps to Reproduce:** 1) Open Edit on a narrow window. 2) Observe cramped/overflowing layout.
**Actual Result:** No tailored small-screen layout.
**Expected Result:** Breakpoints for form/table stacking.
**Root Cause (Possible):** Responsiveness never implemented.
**Suggested Fix:** Add `@media (max-width: 768px)` rules; make GST tri-field and action bars wrap.
**Regression Areas:** Edit layout.
**Screenshots Required:** Yes · **API Affected:** None

#### SJWO-002 · SupplierJobworkOut · Search · **Low** · **P3** · Inconsistent `dcNumber` maxlength across screens
**Description:** Search DC Number input `maxlength="16"` (`supplier-jobwork-out-search.component.html:26`) but Edit DC Number `maxlength="25"` (`supplier-jobwork-out-edit.component.html:53`). Users can create a 25-char number that cannot be typed in full into the search box.
**Preconditions:** DC number length 17–25.
**Steps to Reproduce:** 1) Create DC with 20-char manual number. 2) Search cannot accept full string.
**Actual Result:** Truncated search input.
**Expected Result:** Consistent max length (and matches backend column).
**Root Cause (Possible):** Divergent copy.
**Suggested Fix:** Align both to the backend column length.
**Regression Areas:** Search by exact number.
**Screenshots Required:** No · **API Affected:** None

### B. Form validation

#### SJWO-003 · SupplierJobworkOut · Edit · **High** · **P2** · `onChangeQuantity` writes to a non-existent form control
**Description:** `onChangeQuantity()` calls `this.supplierJobWorkOutEditForm.controls['expectedQuantity'].setValue(...)` (`supplier-jobwork-out-edit.component.ts:879`). The header form has no `expectedQuantity` control (expected quantity lives on `supplierJobWorkOutLineItemsForm` as `expectedQty`). `controls['expectedQuantity']` is `undefined`, so `.setValue` throws a runtime error; the intended guard ("Quantity should not be less than inward qty") never enforces.
**Preconditions:** Editing a line item and lowering Expected Quantity below already-inward qty; `(change)` fires `onChangeQuantity` (`html:379`).
**Steps to Reproduce:** 1) Edit a partially-inwarded line. 2) Change Expected Qty. 3) `onChangeQuantity` runs.
**Actual Result:** `Cannot read properties of undefined (setValue)`; guard bypassed.
**Expected Result:** Reject qty below inward qty on the correct control.
**Root Cause (Possible):** Copy from a different screen; wrong control name.
**Suggested Fix:** Target `supplierJobWorkOutLineItemsForm.controls['expectedQty']`; note a working duplicate guard already exists in `addSupplierJobWorkOutLineItems:732`.
**Regression Areas:** Expected qty vs inward qty validation.
**Screenshots Required:** No · **API Affected:** None

#### SJWO-004 · SupplierJobworkOut · Search · **Medium** · **P2** · No from-date ≤ to-date validation
**Description:** Search requires `dcDate` (from) and `to-dcDate` (to) (`supplier-jobwork-out-search.component.html:31-41`, both `required`), but there is no check that From ≤ To. Backend applies `>= dcDate` and `<= to-dcDate` (`service.ts:1707-1711`); an inverted range silently returns nothing.
**Preconditions:** From > To.
**Steps to Reproduce:** 1) Set From = today, To = last month. 2) Search.
**Actual Result:** "No data" with no explanation.
**Expected Result:** Validation message "From date must be ≤ To date".
**Root Cause (Possible):** Missing cross-field validator.
**Suggested Fix:** Add a form-group validator comparing the two dates.
**Regression Areas:** Search.
**Screenshots Required:** No · **API Affected:** `GET supplierjobworkout/fetch/:exactMatch?`

#### SJWO-005 · SupplierJobworkOut · Edit · **Medium** · **P3** · Blocking native `alert()` used for business validation
**Description:** GST format, HS-code availability, and supplier-x-product expiry use browser `alert()` (`supplier-jobwork-out-edit.component.ts:879, 1094, 1133, 1910`). These block the UI thread, are unstyled, and are inconsistent with the app's `ToasterService`/dialogs used elsewhere.
**Preconditions:** Invalid GST / missing HS code / expired price.
**Steps to Reproduce:** 1) Enter GST `12.3456`. 2) Native alert appears.
**Actual Result:** Native modal alert.
**Expected Result:** Toaster/dialog consistent with the app.
**Root Cause (Possible):** Quick validation stubs.
**Suggested Fix:** Replace with `toasterService.showWarning(...)`.
**Regression Areas:** GST/HS/price validation UX.
**Screenshots Required:** No · **API Affected:** None

#### SJWO-006 · SupplierJobworkOut · Edit · **Low** · **P3** · Decimal precision not enforced on quantities
**Description:** RM Quantity and Expected Quantity are free `type="number"` with no `step`/decimal policy (`html:247, 379`). RM qty is later rounded to 3 decimals in one path (`roundDownToThreeDecimals`, `ts:1664`) but user-entered values are not constrained, so display vs stored precision can differ.
**Preconditions:** Enter `1.23456`.
**Steps to Reproduce:** 1) Enter high-precision qty, Add.
**Actual Result:** Unbounded precision accepted.
**Expected Result:** Consistent decimal policy across entry and calculation.
**Root Cause (Possible):** No `step`/validator.
**Suggested Fix:** Add `step="0.001"` and validate decimals; align with server rounding.
**Regression Areas:** RM/expected qty, costing.
**Screenshots Required:** No · **API Affected:** None

#### SJWO-007 · SupplierJobworkOut · Edit · **Low** · **P3** · Delete control for RM lines hidden while editing
**Description:** The RM table Remove column is hidden in edit mode: `<th [ngClass]="{'hide': this.edit}">Remove` and the matching cell (`supplier-jobwork-out-edit.component.html:296, 313`). In edit an RM row added by mistake cannot be removed (only re-edited), while expected line items remain deletable. If intentional, it should be communicated; otherwise it blocks correction.
**Preconditions:** Editing an existing DC.
**Steps to Reproduce:** 1) Open Edit. 2) RM Remove buttons absent.
**Actual Result:** Cannot remove RM line in edit.
**Expected Result:** Allow removal (subject to inward guards) or show why disabled.
**Root Cause (Possible):** Deliberate lock without messaging.
**Suggested Fix:** Confirm intent; if removal should be blocked only for inwarded RM, gate per-row instead of hiding globally.
**Regression Areas:** RM editing.
**Screenshots Required:** Yes · **API Affected:** None

### C. Grid (list) behaviour

#### SJWO-008 · SupplierJobworkOut · Search/List · **Medium** · **P2** · Filter/sort operate only on the current page; no server sort, no pagination UI
**Description:** The results grid renders `dataSource` directly (`supplier-jobwork-out-search.component.html:92`) and the "Search" box calls `globals.applyDOMFilter(...)` (`ts:197-199`) which filters the DOM only. Backend `fetch` supports `page`/`limit` (`controller.ts:128` `paginateResponse`) but the UI sends none and shows no paginator, so all rows load at once and column-header sorting is absent. On large result sets this is slow and the client-side text filter can hide rows that exist server-side.
**Preconditions:** Large number of matching DCs.
**Steps to Reproduce:** 1) Search a broad date range. 2) All rows load; no page controls; sort unavailable.
**Actual Result:** Unpaginated, unsortable grid; DOM filter only.
**Expected Result:** Server-side pagination + sortable columns, or a virtualized grid.
**Root Cause (Possible):** Grid rendered as a plain table without a data-grid component.
**Suggested Fix:** Pass `page`/`limit`, add a paginator and column sort; keep export operating on the full result set.
**Regression Areas:** List performance, export.
**Screenshots Required:** Yes · **API Affected:** `GET supplierjobworkout/fetch/:exactMatch?`

#### SJWO-009 · SupplierJobworkOut · Search/List · **Low** · **P3** · Empty-state message shown incorrectly / date column source mismatch
**Description:** (a) The "No data matching" block uses `*ngIf="dataSource.length === 0"` (`html:118`) but `showSearchResult` is only set true when data exists, so the empty block appears only transiently and its `filterText` interpolation is misleading. (b) The grid renders `item?.dcDate` (`html:112`) while Excel export reads `dcDateTime || dcDate` (`ts:250`) and the search sends `dcDate`; a DC whose date is stored under `dcDateTime` shows blank in the grid but populated in export.
**Preconditions:** DC with `dcDateTime` populated / `dcDate` null.
**Steps to Reproduce:** 1) Search; 2) compare grid Date column vs exported "Date".
**Actual Result:** Inconsistent date display between grid and export.
**Expected Result:** Single canonical date field used everywhere.
**Root Cause (Possible):** Field renamed (`dcDate` vs `dcDateTime`) inconsistently; model still declares `dcDateTime`.
**Suggested Fix:** Standardize on one field; fix empty-state to render only inside the results panel.
**Regression Areas:** Grid, export.
**Screenshots Required:** Yes · **API Affected:** None

### D. Business logic

#### SJWO-010 · SupplierJobworkOut · Edit (delete line item) · **High** · **P1** · Inward guard on line-item delete uses wrong DC linkage — allows deleting already-inwarded lines (silent data loss)
**Description:** `jobWorkOutLineItemDelete()` computes `inwardQty` by loading `SupplierJobworkIn` rows whose **`dcNumber` equals the Out DC's `dcNumber`** (`supplier-jobwork-out.service.ts:1868-1872`) and `outwardQty` from `SupplierJobworkOut` rows with the same `dcNumber` (`:1873-1877`). Supplier Job Work **In** DC numbers are independent of Out DC numbers, so `supplierJobWorkInExceptionEntity` is almost always empty → `inwardQty = 0` → `deleteStatus = expectedQty <= (outwardQty - 0)` is effectively always true (`:1890`). The intended "cannot delete because already inwarded" guard (`:1894`) therefore rarely triggers, and the code soft-deletes the expected line item and reverts its serial numbers (`lineItemDelete:1905-1935`) even when a Supplier Jobwork In has consumed it. This can orphan inward records and corrupt balance/stock-ledger accounting.
**Preconditions:** A DC-Out line item that has been received via a Supplier Jobwork In.
**Steps to Reproduce:** 1) Create DC-Out, inward part of it via Jobwork In. 2) Open DC-Out edit, delete that line item. 3) Guard passes; line item soft-deleted and serials reverted.
**Actual Result:** Inwarded line deleted; inward/stock references dangle.
**Expected Result:** Delete blocked when `alreadyInwardQuantity > 0` (the UI already disables the button on `alreadyInwardQuantity > 0` at `html:496`, but the API must enforce it server-side).
**Root Cause (Possible):** Inward lookup joins by `dcNumber` instead of by `supplierJobworkOutLineItemId` through `supplierjobworkinlineitemoutlineitem` (the correct linkage used in `cancelById:1790-1796`).
**Suggested Fix:** Compute inward qty by joining `SupplierJobworkInLineItemOutLineItem.supplierJobworkOutLineItemId = <expectedLineItem.id>` (mirroring `cancelById`), sum accepted+rejections+notProcess, and block delete if > 0.
**Regression Areas:** Line-item delete, stock ledger, inward reconciliation.
**Screenshots Required:** No · **API Affected:** `POST supplierjobworkout/jobWorkOutDeleteLineItem`

#### SJWO-011 · SupplierJobworkOut · Edit (serial auto-select) · **Medium** · **P2** · Serial auto-selection is non-deterministic (random direction)
**Description:** `selectItems()` picks serial numbers by walking outward from a start index in a **randomly chosen direction** (`const direction = Math.random() < 0.5 ? -1 : 1`) (`supplier-jobwork-out-edit.component.ts:2174`). For traceable heat/serial numbers, auto-select should be deterministic (e.g. FIFO by control-task order); randomness makes the selected physical serials unpredictable and non-reproducible.
**Preconditions:** Auto-select serial numbers enabled with expected qty < available serials.
**Steps to Reproduce:** 1) Enable auto-select, enter expected qty. 2) Repeat selection; different serials chosen.
**Actual Result:** Random serial subset chosen.
**Expected Result:** Deterministic, ordered selection.
**Root Cause (Possible):** "Nearby" spread implemented with randomness.
**Suggested Fix:** Select the first N enabled serials in a stable order (control-task/serial order), preserving RECEIVED ones first.
**Regression Areas:** Serial traceability, downstream inward matching.
**Screenshots Required:** No · **API Affected:** None

#### SJWO-012 · SupplierJobworkOut · Edit (submit) · **Medium** · **P2** · RM shortage validation is advisory only — user can proceed past a real shortage
**Description:** `validateRawMaterials()` returns per-part shortage/excess and shows a confirmation dialog; on "OK" it continues to save regardless (`supplier-jobwork-out-edit.component.ts:251-299`, dialog `afterClosed` → `saveJobWorkOut`/`duplicateCheck`). There is no hard stop for a genuine RM shortage, so a DC-Out can be sent with insufficient raw material, understating consumption.
**Preconditions:** RM qty entered < required for expected qty.
**Steps to Reproduce:** 1) Add expected line requiring more RM than added. 2) Submit → shortage dialog → confirm.
**Actual Result:** Saves despite shortage.
**Expected Result:** At minimum a distinct hard-block option for shortages, or role-gated override with audit.
**Root Cause (Possible):** Single confirmation path for both excess and shortage.
**Suggested Fix:** Differentiate shortage (block or require privileged override) from excess (warn).
**Regression Areas:** RM consumption, operation costing.
**Screenshots Required:** No · **API Affected:** `POST supplierjobworkout/validate/rm`, `POST supplierjobworkout/create`

#### SJWO-013 · SupplierJobworkOut · Edit (save/update) · **Medium** · **P3** · Edit uses `create` endpoint; declared `update` endpoint does not exist
**Description:** `saveSupplierJobWorkOut()` always posts to `NEW_SAVE_SUPPLIER_JOB_WORK_OUT` (`supplier-jobworkout.service.ts:62-63`, update branch commented out). The constant `NEW_UPDATE_SUPPLIER_JOB_WORK_OUT` (`endpoints.ts:2050` → `supplierjobworkout/update`) has **no matching controller route** (`supplier-jobwork-out.controller.ts` exposes only `create`). Edits rely on `create()` performing an upsert via `entity.id` (`service.ts:132`). Dead constant + non-obvious upsert semantics are a maintenance and correctness risk (e.g. child rows are re-inserted rather than diffed).
**Preconditions:** Editing an existing DC.
**Steps to Reproduce:** 1) Inspect network on save-edit → `create`. 2) `POST supplierjobworkout/update` → 404.
**Actual Result:** Single upsert path; declared update endpoint missing.
**Expected Result:** Either an explicit update route with proper child reconciliation, or documented upsert.
**Root Cause (Possible):** Update path removed but constant/URL left behind.
**Suggested Fix:** Remove the dead constant or implement `update`; ensure edit reconciles (not duplicates) child line items/serials.
**Regression Areas:** Edit persistence, duplicate child rows.
**Screenshots Required:** No · **API Affected:** `POST supplierjobworkout/create`

#### SJWO-014 · SupplierJobworkOut · Model · **Low** · **P3** · `dcNumber` typed as `number` but values are alphanumeric strings
**Description:** `supplier-jobwork-out.ts:9` declares `dcNumber: number` (and `dcDateTime: string`), but DC numbers are uppercased alphanumeric strings and can be `Pending-XXXXXXX` for auto-generate (`service.ts:936 getPendingSupplierJobWorkOutNumber`). The grid also passes `item?.dcNumber` (string) to the PDF generator typed `dcNumber: number` (`search.component.ts:161`).
**Preconditions:** Any DC.
**Steps to Reproduce:** N/A (type-level).
**Actual Result:** Type/value mismatch; misleading typings.
**Expected Result:** `dcNumber: string`.
**Root Cause (Possible):** Stale model.
**Suggested Fix:** Change type to `string`; reconcile the `SupplierJobWorkOut` model with the actual API shape (jobOrder/isCancel/dcDate fields used in the grid are not in the model).
**Regression Areas:** Type safety only.
**Screenshots Required:** No · **API Affected:** None

### E. Error handling

#### SJWO-015 · SupplierJobworkOut · Edit · **Medium** · **P2** · Save error branch keys off wrong response shape; success message may show on failure
**Description:** `saveJobWorkOut()` treats success as `data?.['data']` truthy (`supplier-jobwork-out-edit.component.ts:887`) then reads `data.id` for `supplierJobWorkOutIdEdited` (`:893`) but stores `data?.['data']?.['dcNumber']` (`:896`). The backend `successResponse(savedPo)` wraps the entity under `data`, so `data.id` is `undefined` while `data.data.id` is the real id — the component sets `supplierJobWorkOutIdEdited = undefined`. It then reloads immediately (`:899`), masking the inconsistency, but any logic depending on the returned id is wrong. Conversely, error handling only catches transport errors (`err =>`), not `{ status:false }`-style business errors from `errorResponse`.
**Preconditions:** Save returns a business error payload (not an HTTP error).
**Steps to Reproduce:** 1) Trigger a server-side validation error that returns 200 + errorResponse. 2) Component still enters success branch if `data` present.
**Actual Result:** Wrong id captured; business errors not surfaced distinctly.
**Expected Result:** Read `data.data.id`; branch on the response `status`/success flag.
**Root Cause (Possible):** Mixed assumptions about envelope (`data` vs `data.data`).
**Suggested Fix:** Use the ResponseEntity envelope consistently (`data.success`, `data.data`).
**Regression Areas:** Post-save handling.
**Screenshots Required:** No · **API Affected:** `POST supplierjobworkout/create`

#### SJWO-016 · SupplierJobworkOut · Edit · **Medium** · **P2** · Double-submit possible (Submit not disabled during in-flight save)
**Description:** The Submit button is disabled only by `!supplierJobWorkOutEditForm.valid || submitDisable` (`supplier-jobwork-out-edit.component.html:559`); `submitDisable` is set by price-expiry checks, **not** by the save being in flight. `submitJobWorkOutForm` → `validateRawMaterials` → dialog → `saveJobWorkOut` shows the global loader but does not lock the button, so rapid double-clicks (or clicking again during the confirmation dialog) can enqueue duplicate creates. Server duplicate-check (`duplicateCheck`) only runs when auto-generate is off, so two auto-numbered creates could both proceed.
**Preconditions:** Auto-generate enabled; user double-clicks Submit.
**Steps to Reproduce:** 1) Fill valid form. 2) Double-click Submit quickly.
**Actual Result:** Potential duplicate DC creation.
**Expected Result:** Guard against concurrent submit (disable button until response).
**Root Cause (Possible):** No in-flight flag on submit.
**Suggested Fix:** Set a `saving` flag on submit; disable button; clear in success/error.
**Regression Areas:** Create.
**Screenshots Required:** No · **API Affected:** `POST supplierjobworkout/create`

### F. Performance

#### SJWO-017 · SupplierJobworkOut · Edit · **Medium** · **P3** · Serial/HS/price lookups fire per interaction with no caching or debounce
**Description:** Selecting RM part triggers `hasSupplierXProduct` + `fetchHsCodeByTypeAndProductId` (`ts:1056-1059`), selecting process group triggers `fetchPreviousCompletedProcessId` → `fetchSerialSerialList` (`ts:1169`), and expected-qty changes re-run sync calculations. Child-part lookups are cached (`childPartRelationMap`) but serial/HS/price fetches are not, so repeated selection re-hits the backend. Large process groups reload full serial lists each time.
**Preconditions:** Editing DCs with many serials.
**Steps to Reproduce:** 1) Toggle process group selections. 2) Observe repeated network calls.
**Actual Result:** Redundant fetches.
**Expected Result:** Cache/debounce where results are stable.
**Root Cause (Possible):** No memoization of serial/HS results.
**Suggested Fix:** Cache by (processGroupId/partId) key; debounce qty-driven recomputes.
**Regression Areas:** Edit responsiveness.
**Screenshots Required:** No · **API Affected:** control-task/HS-code fetch APIs.

#### SJWO-018 · SupplierJobworkOut · List · **Low** · **P3** · Browser back/refresh reloads full search via localStorage round-trip
**Description:** Search state is persisted through `SearchStateService` and, on returning from edit, restored (`search.component.ts:76-89`); after a save the module sets `localStorage['supplierJobWorkOutNumber']` and forces a reload (`edit:896-899`) so the search re-runs by DC number on init (`search:69-74`). Combined with XC-006, back/refresh triggers a full re-bootstrap plus a re-search, which is heavy on large data and can momentarily show a stale/empty grid.
**Preconditions:** Save then use browser back/refresh.
**Steps to Reproduce:** 1) Save a DC. 2) App reloads and re-searches.
**Actual Result:** Full reload + re-query.
**Expected Result:** Lightweight state restore without full reload.
**Root Cause (Possible):** Reload-based navigation (XC-006).
**Suggested Fix:** Restore results from state without `location.reload()`.
**Regression Areas:** List navigation.
**Screenshots Required:** No · **API Affected:** `GET supplierjobworkout/fetch/:exactMatch?`

### G. Security

#### SJWO-019 · SupplierJobworkOut · Search/List · **High** · **P1** · Unauthenticated list access (see XC-001)
**Description:** Duplicated here for the security category: `@Public()` on `search`/`fetch` (`controller.ts:65,115`) exposes list data without auth. See XC-001 for full detail and fix.
**Preconditions/Steps/Actual/Expected/Root/Fix:** As XC-001.
**Regression Areas:** List data confidentiality.
**Screenshots Required:** No · **API Affected:** `GET supplierjobworkout/search`, `GET supplierjobworkout/fetch`

#### SJWO-020 · SupplierJobworkOut · Edit · **High** · **P1** · SQL injection in `cancelById` (see XC-002)
**Description:** `.where()` uses the body-supplied `id` directly at `service.ts:1782`. See XC-002 for detail/fix.
**Regression Areas:** Cancel.
**Screenshots Required:** No · **API Affected:** `POST supplierjobworkout/cancelById`

#### SJWO-021 · SupplierJobworkOut · Edit/Search · **Medium** · **P2** · Client-side permission gating only; no per-action authorization on write endpoints
**Description:** Buttons are gated by `fs.userHasAccess('SUPPLIER-JOB-WORK-OUT','CREATE')` client-side (`search.component.ts:62`, `edit.component.ts:207`), but the controller class carries only `@Asset('SUPPLIER-JOB-WORK-OUT')` with no explicit per-action (CREATE/DELETE) authorization on `create`, `cancelById`, `jobWorkOutDeleteLineItem`, `saveFileName`. A user with the asset but without CREATE could call these directly (URL/API manipulation), and hidden buttons don't protect the endpoint.
**Preconditions:** User has asset access but not CREATE; calls API directly.
**Steps to Reproduce:** 1) `POST supplierjobworkout/create` as such a user.
**Actual Result:** Server does not re-check action permission.
**Expected Result:** Server enforces CREATE/DELETE per endpoint.
**Root Cause (Possible):** Authorization enforced only in UI.
**Suggested Fix:** Add action-level guards on write endpoints matching the UI checks.
**Regression Areas:** Create/cancel/delete authorization.
**Screenshots Required:** No · **API Affected:** `create`, `cancelById`, `jobWorkOutDeleteLineItem`, `saveFileName`

#### SJWO-022 · SupplierJobworkOut · Edit (file upload) · **Medium** · **P2** · Upload validation is client-side (extension + size) only
**Description:** File choice restricts to `.pdf` via the `accept` attribute and checks `size > 3072` in JS (`edit.component.html:200`, `ts:1827-1841`); filename is derived from the DC number with `$` substitution (`ts:1849`). There is no evidence of server-side MIME/size/type enforcement in the reviewed path (`saveFileName` only records the name). `accept`/size are trivially bypassed via direct API calls.
**Preconditions:** User with upload access crafts a direct upload.
**Steps to Reproduce:** 1) Upload a non-PDF/oversized file via API.
**Actual Result:** Relies on client checks.
**Expected Result:** Server validates content-type, size, and stored path.
**Root Cause (Possible):** Validation only in component.
**Suggested Fix:** Enforce MIME/size server-side; sanitize filenames.
**Regression Areas:** Document upload.
**Screenshots Required:** No · **API Affected:** upload service, `POST supplierjobworkout/saveFileName`

---

## 3. Appendix

### 3.1 Severity summary

| ID | Title | Severity | Priority |
|----|-------|----------|----------|
| XC-001 | `@Public()` search/fetch — unauth data exposure | Critical | P1 |
| XC-002 | SQL injection via interpolated `id` | High | P1 |
| XC-003 | Service observables swallow HTTP errors | High | P2 |
| XC-004 | No transaction around multi-entity create | Medium | P2 |
| XC-005 | Negative numeric inputs accepted | Medium | P2 |
| XC-006 | Full-page reload navigation | Low | P3 |
| XC-007 | `innerHTML` from DB strings (XSS) | Medium | P2 |
| SJWO-001 | No responsive breakpoints (edit) | Low | P3 |
| SJWO-002 | Inconsistent dcNumber maxlength | Low | P3 |
| SJWO-003 | `onChangeQuantity` writes non-existent control | High | P2 |
| SJWO-004 | No from≤to date validation | Medium | P2 |
| SJWO-005 | Native `alert()` for validation | Medium | P3 |
| SJWO-006 | Decimal precision not enforced | Low | P3 |
| SJWO-007 | RM Remove hidden in edit | Low | P3 |
| SJWO-008 | Client-only filter/sort, no pagination | Medium | P2 |
| SJWO-009 | Empty-state + date field mismatch | Low | P3 |
| SJWO-010 | Delete line-item inward guard broken (data loss) | High | P1 |
| SJWO-011 | Random serial auto-select | Medium | P2 |
| SJWO-012 | RM shortage advisory only | Medium | P2 |
| SJWO-013 | Edit uses create; `update` route missing | Medium | P3 |
| SJWO-014 | `dcNumber` typed as number | Low | P3 |
| SJWO-015 | Save success/error keyed on wrong shape | Medium | P2 |
| SJWO-016 | Double-submit possible | Medium | P2 |
| SJWO-017 | No caching/debounce on lookups | Medium | P3 |
| SJWO-018 | Back/refresh forces reload + re-search | Low | P3 |
| SJWO-019 | Unauth list access (=XC-001) | High | P1 |
| SJWO-020 | SQLi in cancelById (=XC-002) | High | P1 |
| SJWO-021 | Client-only permission gating | Medium | P2 |
| SJWO-022 | Client-only file-upload validation | Medium | P2 |

Counts: **Critical 1 · High 6 · Medium 13 · Low 8** (SJWO-019/020 duplicate XC-001/002 for the security category).

### 3.2 Recommended fix order

1. **XC-001 / SJWO-019 — Remove `@Public()` from search & fetch.** One-line change closing an unauthenticated data leak; highest risk-to-effort.
2. **XC-002 / SJWO-020 — Parameterize the cancel query and validate `id`.** Prevents SQL injection; small, contained change.
3. **SJWO-010 — Fix the line-item delete inward guard.** Prevents silent deletion of already-inwarded lines (data corruption). Reuse the correct join from `cancelById`.
4. **SJWO-003 — Correct `onChangeQuantity` control target.** Restores the "qty ≥ inward" guard that currently throws and is bypassed.
5. **XC-004 — Wrap create in a transaction.** Stops partial writes/orphaned headers on mid-flow failure.
6. **XC-003 — Fix service error propagation.** Removes stuck loaders and surfaces failures across the module (prereq for reliable UX on items above).
7. **SJWO-015 / SJWO-016 — Response-shape handling + double-submit guard.** Prevents wrong-id capture and duplicate DCs.
8. **SJWO-008 — Server pagination + sortable grid.** Addresses list performance before data grows.
9. **SJWO-011 / SJWO-012 — Deterministic serial selection + shortage hard-stop.** Business-integrity correctness for traceability and RM consumption.
10. **XC-005 / XC-007 / SJWO-021 / SJWO-022 — Input hardening (negatives, innerHTML/XSS, server-side authz and upload validation).**
11. **Remaining Low items (SJWO-001/002/006/007/009/013/014/018, XC-006, SJWO-005/017).** UX/maintainability polish.

Reasoning: security and data-corruption defects (unauth access, SQLi, broken delete guard, partial writes) are ordered first because they risk confidentiality and irreversible data damage; correctness/error-handling next because they cause wrong results and duplicates; performance and cosmetic/typing items last as they degrade experience but not integrity.
