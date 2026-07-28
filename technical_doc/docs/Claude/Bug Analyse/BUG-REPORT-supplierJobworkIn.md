# UI / Functional Review — Bug Report

**Modules reviewed**

| # | Module | Route | Primary source |
|---|--------|-------|----------------|
| 1 | Supplier Jobwork In | `layout/supplierJobworkIn` | `poweb/src/app/layout/dc/supplier-jobwork-in/**` |

**Method** — static source review of the Angular components, templates, shared services, routing, and the backing NestJS endpoints (`procurementsvcs`). Every finding below cites the file and line that produces it.

---

## 1. Cross-cutting issues (span multiple screens / shared services)

> These XC items also affect Supplier Jobwork Out; recorded in both reports for independent triage.

### Bug ID: XC-001
**Description:** `supplier-jobwork-in.controller.ts:84-85` (`@Public() @Get("search/:exactMatch?")`) and `:133-134` (`@Public() @Get("fetch/:exactMatch?")`) bypass the class `@Asset('SUPPLIER-JOB-WORK-IN')` guard. Any anonymous caller can list inward DC data.
**Preconditions:** Service reachable.
**Steps to Reproduce:** 1) `GET {procurementsvcs}/supplier-jobwork-in/fetch/false?dcDateTime=2020-01-01` with no token. 2) Data returned.
**Actual Result:** Unauthenticated data access.
**Expected Result:** Auth + read-permission enforced.
**Root Cause (Possible):** `@Public()` left from prototyping.
**Suggested Fix:** Remove `@Public()`; enforce asset + READ action.
**Regression Areas:** List consumers.
**Screenshots Required:** No · **API Affected:** `GET supplier-jobwork-in/search`, `GET supplier-jobwork-in/fetch`

### Bug ID: XC-002
**Description:** `dcInCancel()` builds a raw SQL query that injects the tenant database name and uses `supplierDcIn.id` directly in the `WHERE` clause (`supplier-jobwork-in.service.ts:1615`), and `dcInDeleteLineItem()` does the same with `supplierDcIn.supplierJobworkInId` (`:1678`). Both `id`/`supplierJobworkInId` come from `@Body() ... : any` (controller `:211, 228`) with no numeric validation, and the tenant is interpolated into a database name. A crafted body injects SQL.
**Preconditions:** Authenticated user reaching cancel/delete.
**Steps to Reproduce:** 1) `POST supplier-jobwork-in/cancelById` with `id` = `"1; DROP TABLE ..."`/`"1 OR 1=1"`. 2) Injected predicate executes.
**Actual Result:** User-controlled string concatenated into SQL (and DB name).
**Expected Result:** Parameterized query + validated numeric id; tenant from a safe allow-list.
**Root Cause (Possible):** Manual raw-query construction.
**Suggested Fix:** Use parameter binding `entityManager.query('... suppilerDCId = ?', [Number(id)])`; validate id via DTO/`ParseIntPipe`; validate tenant.
**Regression Areas:** Cancel, delete-line-item.
**Screenshots Required:** No · **API Affected:** `POST supplier-jobwork-in/cancelById`, `POST supplier-jobwork-in/deleteLineItemById`

### Bug ID: XC-003
**Description:** `supplierJobworkIn.service.ts` wraps GETs in `Observable.create(observer => http.get(...).subscribe(data => {...}))` with **no error callback** — `searchSupplierJobworkIn:25-34`, `fetchSupplierJobworkInById:69-79`, `fetchSupplierJobworkOutData:48-57`, `checkSupplierJobworkInDuplicate:132-141`, `deleteJobworkLineById:88-97`, `fetchSupplierJobWorkOutRmInwardLineItemByInOutIds:143-152`. On HTTP error the outer observer never emits/errors, so callers hang (loader stuck; button left disabled). This directly enables the critical SJWI-001 below.
**Preconditions:** Any 4xx/5xx/network error.
**Steps to Reproduce:** 1) Search while backend down → loader spins, no toast.
**Actual Result:** Silent hang.
**Expected Result:** Error surfaced; loader dismissed.
**Root Cause (Possible):** Legacy `Observable.create` wrapper.
**Suggested Fix:** Return `this.http.get(...)` directly (or forward `error: e => observer.error(e)`).
**Regression Areas:** All fetch/save/duplicate/delete flows.
**Screenshots Required:** No · **API Affected:** All GET wrappers in the service.

### Bug ID: XC-004
**Description:** `supplier-jobwork-in.service.ts:create()` (`:99`) saves the header, line items, in/out line items, RM inward line items, and stock ledger in sequence **without a transaction** and **without the serial/balance locking** that the Out service uses (`supplier-jobwork-out.service.ts` `GET_LOCK`). Two concurrent inwards against the same open DC-Out can both pass `validateDcBalancesBeforeSave` (client-side, `edit.component.ts:1885`) and both consume the same balance/serials; a mid-sequence failure leaves partial data (orphan header/line items, stale stock ledger).
**Preconditions:** Concurrent inwards, or a mid-flow save failure.
**Steps to Reproduce:** 1) Two users inward the same open DC-Out balance simultaneously. 2) Both succeed; balance over-consumed.
**Actual Result:** Race / partial writes; balance and serials double-allocated.
**Expected Result:** Serialized allocation (DB lock) inside a transaction; rollback on failure.
**Root Cause (Possible):** Inward create not hardened like outward create.
**Suggested Fix:** Wrap create in `entityManager.transaction`; acquire named locks on the target out-line-items/serials and re-validate balances server-side before persist.
**Regression Areas:** Inward create/update, stock ledger, serial status.
**Screenshots Required:** No · **API Affected:** `POST supplier-jobwork-in/create`, `PUT supplier-jobwork-in/update`

### Bug ID: XC-005
**Description:** Accepted/Casting-Rej/Machine-Rej/Without-Process quantity inputs lack `min="0"`/validators (`supplier-jobwork-in-edit.component.html:158,167,176,187`), and the editable RM Consumption Quantity input (`:392`) is a raw `[(ngModel)]` number with no bounds. Negative values pass client checks and feed stock-ledger/consumption math.
**Preconditions:** Enter `-5`.
**Steps to Reproduce:** 1) Enter negative accepted qty; Add.
**Actual Result:** Negative qty accepted.
**Expected Result:** Reject < 0.
**Root Cause (Possible):** Missing `min` + validators.
**Suggested Fix:** Add `min="0"` and `Validators.min(0)`; server-side guard.
**Regression Areas:** Inward totals, RM consumption, stock ledger.
**Screenshots Required:** No · **API Affected:** `POST supplier-jobwork-in/create`

### Bug ID: XC-006
**Description:** `saveSupplierJobWorkIn` (`edit.component.ts:573-574`), `cancelJobWorkInward` (`:1363`), and `back()` (`:1063`) navigate then call `window.location.reload()`, re-bootstrapping Angular and refetching everything.
**Suggested Fix:** Reset state and use SPA navigation.
**Regression Areas:** Post-save/cancel UX.
**Screenshots Required:** No · **API Affected:** None

---

## 2. Findings by category

### A. Page layout & responsiveness

#### Bug ID: SJWI-010
**Description:** `supplier-jobwork-in-edit.component.scss` has a single `@media (max-width: 600px)` block (`:490`); the "Lists" table has 9 columns including an embedded serial multiselect and RM sub-rows (`html:316-400`) and the inward line-item table 8 columns. Below md these rely only on `.table-responsive` horizontal scroll, and the DC-allocation modal (`html:481-552`) is fixed-width.
**Preconditions:** Narrow viewport.
**Steps to Reproduce:** 1) Open Edit with several inward rows on a small screen.
**Actual Result:** Horizontal overflow; cramped controls.
**Expected Result:** Responsive stacking/scroll affordances.
**Suggested Fix:** Add breakpoints; make the allocation modal responsive.
**Regression Areas:** Edit layout.
**Screenshots Required:** Yes · **API Affected:** None

### B. Form validation

#### Bug ID: SJWI-011
**Description:** The inner form binds `(ngSubmit)="submitDcLineitemsForm(supplierDcLineInEditForm.value)"` (`supplier-jobwork-in-edit.component.html:91`), but **no `submitDcLineitemsForm` method exists** on the component (verified across the 1935-line component; the Add button instead calls `getLineItemsByProcessId`). Pressing Enter inside any field of that form triggers `ngSubmit` → a call to `undefined`, throwing at runtime (and, with strict template checking, a build error).
**Preconditions:** Focus a line-item field and press Enter.
**Steps to Reproduce:** 1) Type in Accepted Qty. 2) Press Enter.
**Actual Result:** Runtime error (`submitDcLineitemsForm is not a function`); no Add performed.
**Expected Result:** Enter either adds the line item or is a no-op.
**Root Cause (Possible):** Renamed/removed handler; template not updated.
**Suggested Fix:** Point `ngSubmit` at `getLineItemsByProcessId(...)` or remove the `ngSubmit` binding (Add button already handles it).
**Regression Areas:** Line-item add via keyboard.
**Screenshots Required:** No · **API Affected:** None

#### Bug ID: SJWI-012
**Description:** Search requires DC From/To dates (`supplier-jobwork-in-search.component.html:31-41`) with no From ≤ To check; backend applies `>=`/`<=` (`service.ts:796-797`), so an inverted range silently yields "No data".
**Suggested Fix:** Cross-field date validator.
**Regression Areas:** Search.
**Screenshots Required:** No · **API Affected:** `GET supplier-jobwork-in/fetch/:exactMatch?`

#### Bug ID: SJWI-013
**Description:** In manual mode, `getLineItemsByProcessId` requires `totalInputQty > 0` and each row `consumeQty ≤ remainingQty`, and blocks when `totalInputQty > totalConsumedAcrossDcs` (`edit.component.ts:781-798`). It does **not** require `totalConsumed === totalInput`: if a user allocates more consume than the form total, the extra consume is silently ignored during priority allocation (accepted→machine→casting→notProcess, `:882-905`), so the DC balance the user "consumed" in the modal is not actually reduced by that surplus. The modal's own Confirm button requires an exact match (`html:548`), but the Add button bypasses the modal, so the two paths disagree.
**Preconditions:** Manual mode; consume qty entered greater than form total.
**Steps to Reproduce:** 1) Select DC(s), set consume qty > accepted+rej+notProcess total. 2) Click Add (not modal Confirm).
**Actual Result:** Surplus consume dropped; allocation ≠ what the modal enforced.
**Expected Result:** Consistent rule across Add and modal (require equality or clearly define surplus handling).
**Root Cause (Possible):** Two validation paths (Add vs modal) with different rules.
**Suggested Fix:** Enforce `totalConsumed === totalInput` in `getLineItemsByProcessId` too, or remove the separate Add path.
**Regression Areas:** Manual DC allocation, balance accounting.
**Screenshots Required:** Yes · **API Affected:** None

#### Bug ID: SJWI-014
**Description:** Accepted/Casting/Machine are `required` (`html:158-178`) but a value of `0` satisfies `required`; the only "must be > 0" enforcement is the aggregate `totalInputQty <= 0` check in the manual branch (`edit.component.ts:786`) and FIFO relies on server `isValidInwardQuantity`. In FIFO mode a line with all-zero quantities can be Added and only rejected later by the server "Please Check the Job Work Out DC Quantity" path (`:1042-1043`), which also splices the just-pushed item — confusing UX.
**Suggested Fix:** Validate total inward > 0 before calling the service in both modes.
**Regression Areas:** Inward add.
**Screenshots Required:** No · **API Affected:** `GET supplier-jobwork-in/getjobfifo/`

### C. Grid (list) behaviour

#### Bug ID: SJWI-015
**Description:** Results render `dataSource` directly (`supplier-jobwork-in-search.component.html:81`) and the search box calls `globals.applyDOMFilter` (DOM-only, `ts:165-167`). Backend `fetch` supports `page`/`limit` (`controller.ts:146` `paginateResponse`) but the UI sends none and shows no paginator or sortable headers, so all rows load at once. Same limitation as the Out module.
**Suggested Fix:** Server pagination + sortable columns.
**Regression Areas:** List performance, export.
**Screenshots Required:** Yes · **API Affected:** `GET supplier-jobwork-in/fetch/:exactMatch?`

#### Bug ID: SJWI-016
**Description:** `searchSupplierJobworkIn` sets `stringType = ["name"]` (`service.ts:760-762`) but `SupplierJobworkIn` has no `name` column (search is by supplierId/dcNumber/date). The entry is inert and misleading.
**Suggested Fix:** Remove or replace with `dcNumber`.
**Regression Areas:** None (dead config).
**Screenshots Required:** No · **API Affected:** `GET supplier-jobwork-in/search`

### D. Business logic

#### Bug ID: SJWI-001
**Description:** Submit runs `checkDuplicate()` which calls `checkSupplierJobworkInDuplicate` → `GET NEW_PROCUREMENT_SVCS + 'supplier-jobwork-in/validateDcNumberDuplicate?...'` (`supplierJobworkIn.service.ts:132-141`; endpoint `endpoints.ts:2570`). **No `validateDcNumberDuplicate` route exists in `procurementsvcs`** (verified: zero matches in `procurementsvcs/src`; the controller has no such handler and no catch-all GET), so the request 404s. Because the service wraps the call in `Observable.create` with no error forwarding (XC-003), the outer observer in `checkDuplicate` receives neither `next` nor `error`, so nothing after it runs while `submitDisable` was set `true` at entry (`edit.component.ts:463`). Result: clicking Submit disables the button and then hangs — the DC is never created/updated.
**Preconditions:** Any create or edit submit.
**Steps to Reproduce:** 1) Fill a valid inward. 2) Click Submit. 3) Observe 404 to `validateDcNumberDuplicate`; button stays disabled; no toast; no save.
**Actual Result:** Submit dead-ends; inward cannot be saved.
**Expected Result:** Duplicate check succeeds (or errors visibly) and submit proceeds to `submitDcForm`/`saveSupplierJobWorkIn`.
**Root Cause (Possible):** Backend route renamed/never implemented; frontend still points at it; error swallowed by Observable wrapper.
**Suggested Fix:** Implement `GET supplier-jobwork-in/validateDcNumberDuplicate` (mirroring the Out `search` exact-match duplicate lookup), **and** fix XC-003 so a 404 surfaces instead of hanging. Add a submit timeout/error toast as defense-in-depth.
**Regression Areas:** All inward create/edit.
**Screenshots Required:** Yes · **API Affected:** `GET supplier-jobwork-in/validateDcNumberDuplicate` (missing)

#### Bug ID: SJWI-002
**Description:** `supplier-jobwork-in.controller.ts:104-118` exposes `@Delete(":id")` → `service.delete()` which runs `entityManager.delete(SupplierJobworkIn, id)` (`service.ts:801-808`) — a **physical delete** with no cancel/inward-usage check, no serial reversion, no stock-ledger reversal, and no soft-delete. It orphans child line items / in-out line items / RM inward rows and leaves stale stock-ledger entries. The class has only `@Asset('SUPPLIER-JOB-WORK-IN')`, so any user with the asset can trigger it by URL manipulation. (The UI's own `removeInward` uses a soft `isDelete=1` path and the trash button is commented out in the template — see SJWI-004 — so this endpoint is reachable only directly, which is exactly the risk.)
**Preconditions:** User with the asset calls `DELETE supplier-jobwork-in/{id}`.
**Steps to Reproduce:** 1) `DELETE supplier-jobwork-in/123`.
**Actual Result:** Row hard-deleted; children orphaned; stock ledger/serials not reverted.
**Expected Result:** No hard-delete endpoint, or a guarded soft-delete that reverts serials/stock and blocks when used in OS inward inspection (as `dcInCancel` does).
**Root Cause (Possible):** Scaffolded CRUD delete left exposed.
**Suggested Fix:** Remove the endpoint or replace with the guarded cancel logic; add action-level authorization.
**Regression Areas:** Inward lifecycle, stock ledger, serial status.
**Screenshots Required:** No · **API Affected:** `DELETE supplier-jobwork-in/:id`

#### Bug ID: SJWI-003
**Description:** Each RM sub-row exposes an editable number input bound to `rm.rmPartQty` (`supplier-jobwork-in-edit.component.html:392-395`), and `saveSupplierJobWorkIn` forwards `supplierJobWorkOutRmLineItemList` (built from these `rmPartQty` values, filtered `> 0`) as `supplierJobWorkOutRmInwardLineItem` plus `supplierjobworkInwardListForStockLedger` (`edit.component.ts:552-559`). There is no bound-check against the computed/available RM quantity, so a user can overwrite it with an arbitrary (or, per XC-005, negative) value that then updates the stock ledger.
**Preconditions:** Add an inward with RM sub-rows.
**Steps to Reproduce:** 1) Add a line item; 2) overwrite RM Consumption Qty with an arbitrary number; 3) Submit.
**Actual Result:** Arbitrary RM consumption persisted to stock ledger.
**Expected Result:** Validate against computed/available RM; block invalid values.
**Root Cause (Possible):** Raw `ngModel` without validation.
**Suggested Fix:** Validate rmPartQty against `totalInwardQuantity`/available; enforce min 0 and an upper bound; re-validate server-side.
**Regression Areas:** Stock ledger, RM reconciliation.
**Screenshots Required:** No · **API Affected:** `POST supplier-jobwork-in/create`

#### Bug ID: SJWI-004
**Description:** `removeInward(id)` fetches the record, sets `responseData.data.isDelete = 1`, and calls `saveSupplierJobworkIn(...)` with an **empty success subscriber** — no toast, no list refresh — and `console.error` only on failure (`supplier-jobwork-in-search.component.ts:221-233`). The invoking trash button is commented out in the template (`search.component.html:88-94`), so it is currently dead code; if re-enabled it silently mutates the record with no user feedback and re-saves the entire object via `PUT update`.
**Preconditions:** Trash button re-enabled.
**Steps to Reproduce:** 1) Un-comment the delete button; click it.
**Actual Result:** Row soft-deleted with no visible result; list not refreshed.
**Expected Result:** Confirmation, success/error toast, list refresh — or remove the dead code.
**Root Cause (Possible):** Abandoned feature.
**Suggested Fix:** Remove `removeInward` or complete it (confirmation + feedback + refresh) and route through a dedicated delete endpoint, not a full-object save.
**Regression Areas:** List delete.
**Screenshots Required:** No · **API Affected:** `PUT supplier-jobwork-in/update`

#### Bug ID: SJWI-005
**Description:** `emitAutoSerialNo`/`selectBulkSerialNumbersFromClickedItem` select a sliding window of `expectedQuantity` enabled serials starting near the clicked one, clamped to the end (`edit.component.ts:1655-1696`), while forcing INSPECTED serials to stay selected (`autoSelectSerialNumbers:1533-1559`, `deSelectAll:1797-1813`). The windowing picks serials adjacent to the click rather than the specific ones chosen, which for traceable heat/serial numbers can select the wrong physical items; the multiple interacting maps (`transformedSerialNumbers`, `selectedSerialNumbers`, `deSelectedSerialNumbers`) make correctness fragile.
**Preconditions:** Auto-select enabled with more available serials than expected qty.
**Steps to Reproduce:** 1) Enable Auto Select; click a serial mid-list. 2) A window around it is selected.
**Actual Result:** Adjacent (not exact) serials selected.
**Expected Result:** Deterministic, explicit selection of intended serials.
**Root Cause (Possible):** Window-based bulk pick.
**Suggested Fix:** Select exactly the clicked serial (manual) or the first N in stable order (auto); add unit tests around INSPECTED preservation.
**Regression Areas:** Serial traceability, `validateSerialNumberSelection`.
**Screenshots Required:** No · **API Affected:** None

#### Bug ID: SJWI-006
**Description:** `submitDcForm` sets `postData.dcDate = this.datePipe.transform(postData?.dcDate, ...)` (`edit.component.ts:504`) but the form has no `dcDate` control (it has `dcDateTime`), so `postData.dcDate` is `undefined` → transformed to `null`. It then also sets `dcDateTime` correctly (`:506`). The stray `dcDate` assignment is dead/misleading and could confuse the backend DTO mapping.
**Suggested Fix:** Remove the `dcDate` line; keep `dcDateTime`.
**Regression Areas:** Payload shape.
**Screenshots Required:** No · **API Affected:** `POST supplier-jobwork-in/create`

### E. Error handling

#### Bug ID: SJWI-007
**Description:** `supplier-jobwork-in.controller.ts:36-39` catches every error in `create` and rethrows `InternalServerErrorException('Error While Adding Supplier Jobwork Inward => ' + e)`. Unlike the Out module (which preserves `BadRequestException` for serial conflicts), specific business errors (validation, balance) collapse into a 500 with a concatenated stack string, and the client's generic `error` handler shows only "Alert!" (`edit.component.ts:578-583`). Users get no actionable message.
**Preconditions:** Any handled business error during create.
**Steps to Reproduce:** 1) Trigger a validation failure server-side. 2) Client shows generic alert.
**Actual Result:** Opaque 500; message lost.
**Expected Result:** Preserve typed exceptions / meaningful messages.
**Root Cause (Possible):** Blanket try/catch rethrow.
**Suggested Fix:** Rethrow known exceptions as-is; map others to meaningful responses.
**Regression Areas:** Create error UX.
**Screenshots Required:** No · **API Affected:** `POST supplier-jobwork-in/create`

#### Bug ID: SJWI-008
**Description:** `cancelJobWorkInward` and `deleteJobWorkInwardLineItem` subscribe with an `error =>` branch that only calls `appComponent.loader(false)` with **no user message** (`edit.component.ts:1369-1371, 1405-1407`); `cancelJobWorkInward` also never sets `loader(true)` before the call, and on success reloads the page. A failed cancel/delete leaves the user with no feedback.
**Suggested Fix:** Show a warning toast on error; set/clear the loader consistently.
**Regression Areas:** Cancel/delete feedback.
**Screenshots Required:** No · **API Affected:** `POST supplier-jobwork-in/cancelById`, `POST supplier-jobwork-in/deleteLineItemById`

### F. Performance

#### Bug ID: SJWI-017
**Description:** Adding a line item fetches serials/RM in `fetchSupplierJobWorkOutRmLineiItemList`/`retrieveSupplierJobWorkOutRmInwardLineItem` (`edit.component.ts:263-380`), and serial changes call `refreshLineSerialSelection` which reassigns `supplierJobWorkOutInLineItems = [...]` each time (`:1815-1823`), forcing full-array change detection and re-render of the multi-column list per keystroke/selection. On DCs with many serials this is noticeably heavy. Balance validation also re-queries open DCs per process group at save (`validateDcBalancesBeforeSave:1885-1932`).
**Suggested Fix:** Use `trackBy` on the lists, mutate targeted rows, cache serial/RM lookups, and batch balance validation.
**Regression Areas:** Edit responsiveness.
**Screenshots Required:** No · **API Affected:** serial/RM fetch APIs.

#### Bug ID: SJWI-018
**Description:** After save, the module sets `localStorage['supplierJobWorkInNumber']` and reloads (`edit.component.ts:572-574`); on init the search re-runs by that number (`search.component.ts:59-65`). Combined with `window.location.reload()`, browser back/refresh re-bootstraps the SPA and re-queries, heavy on large data and briefly showing an empty grid.
**Suggested Fix:** Restore results from `SearchStateService` without full reload.
**Regression Areas:** List navigation.
**Screenshots Required:** No · **API Affected:** `GET supplier-jobwork-in/fetch/:exactMatch?`

### G. Security

#### Bug ID: SJWI-009
**Description:** Unlike the Out module (which gates Add/Submit with `fs.userHasAccess('SUPPLIER-JOB-WORK-OUT','CREATE')`), the In module has **no `isUserHasSupplierJobWorkInWrite`/CREATE check** at all: the search "Add Supplier Dc In" button (`search.component.html:6`) and the edit Add/Submit buttons (`edit.component.html:239, 461`) are always shown. Server-side, the controller carries only `@Asset('SUPPLIER-JOB-WORK-IN')` with no per-action guard on `create`/`update`/`cancelById`/`deleteLineItemById`/`@Delete(:id)`. Any user with the asset can create/modify/delete inward DCs regardless of finer permissions.
**Preconditions:** User with asset access but without create/delete rights.
**Steps to Reproduce:** 1) Log in as such a user. 2) Add button visible; API accepts create/delete.
**Actual Result:** No create/delete restriction.
**Expected Result:** UI gating + server action-level authorization consistent with the Out module.
**Root Cause (Possible):** Permission checks never added to In.
**Suggested Fix:** Add `userHasAccess('SUPPLIER-JOB-WORK-IN','CREATE'/'DELETE')` gating in templates and matching server guards.
**Regression Areas:** Create/cancel/delete authorization.
**Screenshots Required:** No · **API Affected:** `create`, `update`, `cancelById`, `deleteLineItemById`, `DELETE :id`

#### Bug ID: SJWI-019
**Description:** Duplicated for the security category: `@Public()` on `search`/`fetch` (`controller.ts:84,133`). See XC-001.
**Regression Areas:** List confidentiality.
**Screenshots Required:** No · **API Affected:** `GET supplier-jobwork-in/search`, `GET supplier-jobwork-in/fetch`

#### Bug ID: SJWI-020
**Description:** Duplicated for the security category: interpolated `id`/tenant in `dcInCancel`/`dcInDeleteLineItem` (`service.ts:1615,1678`). See XC-002.
**Regression Areas:** Cancel/delete.
**Screenshots Required:** No · **API Affected:** `POST supplier-jobwork-in/cancelById`, `POST supplier-jobwork-in/deleteLineItemById`

#### Bug ID: SJWI-021
**Description:** File input restricts to `.pdf` via `accept` and checks `size > 3072` in JS (`edit.component.html:69`, `ts:1066-1080`); filename derived from DC number (`ts:1088`). No server-side MIME/size enforcement is evident in `saveFileName` (records name only). Trivially bypassed via direct upload.
**Suggested Fix:** Enforce content-type/size server-side; sanitize filenames.
**Regression Areas:** Document upload.
**Screenshots Required:** No · **API Affected:** upload service, `POST supplier-jobwork-in/saveFileName`

---

## 3. Appendix

### 3.1 Severity summary

| ID | Title | Severity | Priority |
|----|-------|----------|----------|
| XC-001 | `@Public()` search/fetch — unauth data exposure | Critical | P1 |
| XC-002 | SQL injection via interpolated id/tenant | High | P1 |
| XC-003 | Service observables swallow HTTP errors | High | P2 |
| XC-004 | No transaction/serial lock on inward create (race) | High | P1 |
| XC-005 | Negative numeric inputs accepted | Medium | P2 |
| XC-006 | Full-page reload navigation | Low | P3 |
| SJWI-001 | Duplicate-check endpoint missing — submit hangs | Critical | P1 |
| SJWI-002 | Unguarded hard delete `@Delete(:id)` | High | P1 |
| SJWI-003 | Editable RM consumption feeds stock ledger unvalidated | Medium | P2 |
| SJWI-004 | Broken dead soft-delete `removeInward` | Medium | P3 |
| SJWI-005 | Fragile/window-based serial auto-select | Medium | P2 |
| SJWI-006 | `submitDcForm` transforms non-existent dcDate | Low | P3 |
| SJWI-007 | `create` collapses errors to generic 500 | Medium | P2 |
| SJWI-008 | Cancel/delete lack error feedback | Medium | P2 |
| SJWI-009 | No write/create permission gating | Medium | P2 |
| SJWI-010 | Minimal responsive coverage | Low | P3 |
| SJWI-011 | `ngSubmit` calls undefined method | High | P1 |
| SJWI-012 | No from≤to date validation | Medium | P2 |
| SJWI-013 | Manual allocation Add vs modal rule mismatch | Medium | P2 |
| SJWI-014 | All-zero inward line addable in FIFO | Low | P3 |
| SJWI-015 | Client-only filter, no pagination/sort | Medium | P2 |
| SJWI-016 | Dead search config `["name"]` | Low | P3 |
| SJWI-017 | Per-line lookups + full re-clone on change | Medium | P3 |
| SJWI-018 | Back/refresh forces reload + re-search | Low | P3 |
| SJWI-019 | Unauth list access (=XC-001) | Critical | P1 |
| SJWI-020 | SQLi in cancel/delete (=XC-002) | High | P1 |
| SJWI-021 | Client-only file-upload validation | Medium | P2 |

Counts: **Critical 2 · High 5 · Medium 11 · Low 5** (SJWI-019/020 duplicate XC-001/002 for the security category).

### 3.2 Recommended fix order

1. **SJWI-001 — Implement (or repoint) the duplicate-check endpoint.** The module currently cannot save any inward; this is a total functional block. Pair with XC-003 so failures surface instead of hanging.
2. **XC-001 / SJWI-019 — Remove `@Public()` from search & fetch.** One-line change closing unauthenticated data exposure.
3. **SJWI-002 — Remove/guard the hard-delete `@Delete(:id)`.** Prevents irreversible data loss and orphaned children/stock.
4. **XC-002 / SJWI-020 — Parameterize cancel/delete raw queries; validate id.** Closes SQL injection.
5. **XC-004 — Transaction + serial/balance locking on inward create.** Prevents double-consumption races and partial writes to the stock ledger.
6. **SJWI-011 — Fix the undefined `ngSubmit` handler.** Removes a runtime crash on Enter and unblocks keyboard line-item add.
7. **XC-003 — Fix service error propagation.** Underpins reliable submit/cancel/delete UX (prereq for several items above) and stops stuck loaders.
8. **SJWI-003 / XC-005 — Validate RM consumption and reject negatives.** Protects stock-ledger integrity.
9. **SJWI-013 / SJWI-005 — Align manual-allocation rules and make serial selection deterministic.** Business-integrity of balances and traceability.
10. **SJWI-007 / SJWI-008 / SJWI-009 — Error messaging + server-side authorization.**
11. **SJWI-015 — Server pagination/sort.** Before data grows.
12. **Remaining Low items (SJWI-004/006/010/014/016/018, XC-006, SJWI-021, SJWI-017).** Cleanup, responsiveness, and performance polish.

Reasoning: SJWI-001 is first because it makes the entire screen non-functional (no save possible); next come confidentiality (unauth access), irreversible data loss (hard delete), and injection, which threaten security and data integrity; then concurrency/transaction safety and the runtime crash; error-handling and authorization follow because they cause wrong/opaque outcomes; performance and cosmetic items are last as they degrade experience but not correctness.
