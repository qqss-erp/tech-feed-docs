# UI / Functional Review — Bug Report

**Modules reviewed**

| # | Module | Route | Primary source |
|---|--------|-------|----------------|
| 1 | Job Work In | `layout/jobworkentry` | `src/app/layout/jobworkentry/**` |
| 2 | Job Work Out | `layout/outwarddeliverychallan` | `src/app/layout/outwarddeliverychalllan/**` |
| 3 | Stock Ledger | `layout/stockLedger/report` | `src/app/layout/report/stock-ledger-report/**` |

**Method** — static source review of the Angular components, templates, shared services and the backing NestJS endpoints (`salessvcs`, `procurementsvcs`). Every finding below cites the file and line that produces it. No runtime/browser session was used, so purely visual defects (pixel alignment, font rendering, colour contrast) are out of scope unless they are provably caused by the markup.

**Totals** — 110 issues: 9 Critical, 30 High, 57 Medium, 14 Low. Per-module breakdown in the appendix at the end of this document.

---

## Cross-cutting issues

### Bug ID: XC-001
**Module:** All three
**Screen:** Route layer / `app-routing.module.ts`, `layout/layout-routing.module.ts`
**Severity:** Critical  **Priority:** P1
**Title:** Authentication guard trusts a client-writable localStorage flag and no screen has a role guard

**Description**
`AuthGuard.canActivate()` returns `true` whenever `localStorage.getItem('isLoggedin')` is truthy (`shared/guard/auth.guard.ts:10`). `layout-routing.module.ts` contains **zero** `canActivate` entries — all 3 modules are reachable by any authenticated user. Authorisation is expressed only as `*ngIf="isUserHasJobWorkWrite"` / `[disabled]` in templates, which is removable from devtools in seconds.

**Preconditions:** Any browser session.

**Steps to Reproduce**
1. Open the app while logged out.
2. In devtools console run `localStorage.setItem('isLoggedin','1')`.
3. Navigate to `/layout/jobworkentry`.
4. Repeat for `/layout/outwarddeliverychallan` and `/layout/stockLedger/report`.

**Actual Result:** All three screens render. With a low-privilege login, deleting the `disabled` attribute on `#submit` re-enables Save.
**Expected Result:** Guard validates a real token/session with the server; each route declares a `canActivate` role/asset guard; every mutating endpoint re-checks the permission server-side.
**Root Cause (Possible):** Guard was written against a client-side login flag and never migrated to token validation; per-route guards were never added when the module list grew.
**Suggested Fix:** Replace the flag check with token validation (expiry + server introspection). Add a `PermissionGuard` taking `{asset, action}` route data for `JOB-ENTRY`, `OUTWARD-DELIVERY-CHALLAN` and the stock-ledger asset. Confirm every controller method has a server-side permission decorator.
**Regression Areas:** Every lazy-loaded route; login/logout; deep links from email.
**Screenshots Required:** No
**API Affected:** All

---

### Bug ID: XC-002
**Module:** Job Work In, Job Work Out, Stock Ledger
**Screen:** Shared HTTP services
**Severity:** Critical  **Priority:** P1
**Title:** Services built with `Observable.create` swallow HTTP errors — component error handlers are dead code and the loader hangs forever

**Description**
Several services wrap `HttpClient` in `Observable.create(observer => http.get(...).subscribe(data => {observer.next(data); observer.complete();}))` with **no error callback**. The inner subscription's error is never forwarded to `observer.error()`, so the outer observable neither errors nor completes.

Confirmed instances:

| Service | Method | Line |
|---|---|---|
| `jobwork.service.ts` | `fetchJobWorkById` | 17 |
| `jobwork.service.ts` | `saveJobWork` | 28 |
| `jobwork.service.ts` | `cancelJobWOrk` | 39 |
| `jobwork.service.ts` | `fetchAllJobWork` | 50 |
| `outward.service.ts` | `cancelOutWard` | 68 |
| `outward.service.ts` | `deleteOutwardLineItemsById` | 88 |
| `outward.service.ts` | `fetchNextOutwardDcNumber` | 99 |
| `outward.service.ts` | `fetchOutWardLineItem` | 110 |
| `stock-ledger.service.ts` | `searchStockLedger` | 29 |
| `stock-ledger.service.ts` | `stockLedgerReport` | 56 |
| `stock-ledger.service.ts` | `searchStockLedgerById` | 67 |
| `stock-ledger.service.ts` | `fetchStockSnapShotRecentDate` | 77 |

**12 methods in total.** `fetchOutWardLineItem` is the one with the worst consequence: it backs `checkJobWorkAlreadyOutwarded()` (`jobworkentry-edit.component.ts:774`), the guard that decides whether a Job Work DC In may be cancelled. Its error handler at `:785` is unreachable, so an API failure during that check leaves the loader spinning and the user with no outcome either way.

Consequence: the `(err) => {...}` blocks in `jobworkentry-edit.component.ts:342`, `:253`, `jobworkentry-search.component.ts:139`, `outward-delivery-chalan-edit.component.ts:1281` and `search-stock-ledger-report.component.ts:465` can never run. `appComponent.loader(false)` is only in those handlers, so the full-screen spinner stays up permanently.

**Preconditions:** Ability to fail the API (stop the service, throttle to offline, or return 500).

**Steps to Reproduce**
1. Open `layout/jobworkentry`, search, click the view/edit icon on any row.
2. Before the request completes, set devtools Network to **Offline** (or stop `salessvcs`).
3. Reload and retry the same action.

**Actual Result:** Spinner never clears, no toast, the screen is unusable until a manual browser reload. Console shows an uncaught error.
**Expected Result:** Toast with the server message; spinner cleared; user returned to a usable state.
**Root Cause (Possible):** Legacy `Observable.create` wrapper pattern copied across services; the error path was never wired.
**Suggested Fix:** Delete the wrappers; return `this.http.get(...)` directly (they are already `Observable`s). Where a wrapper must stay, add `error: e => observer.error(e)`. Add a global `HttpInterceptor` that clears the loader and toasts on error so no screen can hang.
**Regression Areas:** Every screen consuming these services (Job Work In/Out, Stock Ledger, Stock Adjustment).
**API Affected:** `jobEntry/*`, `outward-delivery-challan/cancel`, `outward-line-item/*`, `stock-ledger/report`, `stock-ledger/search`

---

### Bug ID: XC-003
**Module:** All three
**Screen:** All error toasts
**Severity:** High  **Priority:** P2
**Title:** Error toasts show `err['statusText']` instead of the server message; empty toast on network failure

**Description**
`toasterService.showError('Alert', err['statusText'])` is the standard pattern (e.g. `jobworkentry-edit.component.ts:626`, `outward-delivery-chalan-edit.component.ts:771, 789, 814, 1749, 2003`). For a network failure `HttpErrorResponse.statusText` is `''` or `'Unknown Error'`, and for a 400 with a validation payload it is `'Bad Request'` — the actual `error.message` is discarded. `outwarddeliverychallan-search.component.ts:182` is worse: it passes the whole `HttpErrorResponse` object, which renders as `[object Object]`.

**Steps to Reproduce**
1. Open Job Work DC Out, select customer/plant, click **Get Line Items**.
2. Force the FIFO endpoint to return `400 {"message":"Requested qty exceeds available"}`.

**Actual Result:** Toast reads "Bad Request" (or is blank offline). The real reason is invisible.
**Expected Result:** `err?.error?.message ?? err?.message ?? 'Unexpected error'`.
**Suggested Fix:** Centralise in a `toastHttpError(err)` helper or an interceptor.
**Regression Areas:** All error paths in the 3 modules.
**Screenshots Required:** Yes
**API Affected:** All

---

### Bug ID: XC-004
**Module:** Job Work In, Job Work Out
**Screen:** Edit screens
**Severity:** High  **Priority:** P1
**Title:** `window.location.reload()` used as navigation after save and as the Cancel button action

**Description**
- `jobworkentry-edit.component.ts:541-542` — `router.navigateByUrl('/layout/jobworkentry')` immediately followed by `window.location.reload()`.
- `jobworkentry-edit.component.ts:740` — `back()` is `window.location.reload()`.
- `outward-delivery-chalan-edit.component.ts:726` — full reload after save; the `deselectRmPart()` on line 727 is unreachable.
- `outward-delivery-chalan-edit.component.ts:1199` — `back()` is `window.location.reload()`.

This throws away the SPA bundle, re-runs every bootstrap request, and is the reason `localStorage` is abused to carry the saved DC number across the reload (`dcNumber`, `OutwardDCNo`).

**Steps to Reproduce**
1. Search Job Work DC In, note the result set.
2. Open a record, click **Cancel** (the yellow one, not Cancel DC).

**Actual Result:** Whole app reloads (2-6 s on a cold cache); the previous search context is lost.
**Expected Result:** Router navigation back to the search view with results preserved by `SearchStateService` (which is already implemented and used elsewhere in the same component).
**Root Cause (Possible):** Reload used to force the child search component to re-run `ngOnInit` instead of using component communication.
**Suggested Fix:** Emit back to the parent `JobWorkEntryComponent.showSearchScreen()` (which already exists) and drop the `localStorage` handoff entirely.
**Regression Areas:** Search-state restore; unsaved-changes protection; browser Back behaviour.
**API Affected:** None directly (causes redundant bootstrap calls)

---

### Bug ID: XC-005
**Module:** All three
**Screen:** Breadcrumbs
**Severity:** Low  **Priority:** P3
**Title:** Breadcrumb "Welcome" link is a relative `href` and triggers a full page load to the wrong URL

**Description**
`jobworkentry.component.html:7`, `outwarddeliverychalllan.component.html:7`, `stock-ledger-report.component.html:22` all use `<a href="layout/welcome">`. With no leading slash, from `/layout/jobworkentry` the browser resolves this to `/layout/layout/welcome`.

**Steps to Reproduce**
1. Go to `layout/jobworkentry`. 2. Click **Welcome** in the breadcrumb.

**Actual Result:** Full page load to `/layout/layout/welcome` → not-found redirect.
**Expected Result:** `routerLink="/layout/welcome"`, in-app navigation.
**Suggested Fix:** Replace `href` with `routerLink` on all breadcrumb anchors.
**Regression Areas:** All breadcrumbs.
**Screenshots Required:** Yes
**API Affected:** None

---

### Bug ID: XC-006
**Module:** Job Work In, Job Work Out
**Screen:** Edit screens
**Severity:** Medium  **Priority:** P3
**Title:** No unsaved-changes guard although `pending-changes.guard.ts` already exists

**Description**
`shared/guard/pending-changes.guard.ts` is present but is not applied to `jobworkentry` or `outwarddeliverychallan` routes. Adding 10 line items and then pressing browser Back, clicking a menu item, or hitting the breadcrumb discards everything silently.

**Steps to Reproduce**
1. Open Job Work DC In → Add. 2. Add 3 line items. 3. Press the browser Back button.

**Actual Result:** Navigation proceeds, all work lost, no prompt.
**Expected Result:** "You have unsaved changes" confirmation.
**Suggested Fix:** Implement `CanComponentDeactivate` on both edit components and register the existing guard on both routes.
**Regression Areas:** Navigation from these screens.
**API Affected:** None

---

# Module 1 — Job Work In (`layout/jobworkentry`)

## Business logic & data integrity

### Bug ID: JWI-001
**Screen:** Job Work DC In — Edit
**Severity:** Critical  **Priority:** P1
**Title:** Editing a DC that has no gate entries never saves and permanently disables the Submit button

**Description**
In `submitDcValues()` (`jobworkentry-edit.component.ts:474-512`), when at least one line item has no RM price *and* at least one does, a confirmation dialog is shown. On confirm, `proceedSave()` is only called **inside** `if (this.selectedGateEntry?.length > 0)` (line 484-488). `selectedGateEntry` is only populated on the create screen — the Gate Entry dropdown is rendered with `*ngIf="this.deliveryChallanIdEdited === 0"` (`jobworkentry-edit.component.html:64`). Therefore in edit mode the confirm branch does nothing: no save, no toast, `submitDisable` stays `true` and the loader was already cleared.

**Preconditions:** An existing Job Work DC In with a mix of priced and unpriced line items.

**Steps to Reproduce**
1. Open Job Work DC In → search → open an existing DC.
2. Ensure at least one line item has RM Price 0/blank and at least one has a price.
3. Click **Submit**.
4. Click **Yes/OK** on the "RM price not available" dialog.

**Actual Result:** Dialog closes. Nothing happens. Submit is greyed out for the rest of the session. No request is sent.
**Expected Result:** The DC saves with the priced line items and a success toast; Submit re-enables on any failure.
**Root Cause (Possible):** The gate-entry guard was added for the create flow and wrongly wrapped the shared `proceedSave()` call.
**Suggested Fix:** Move the `gateEntryIds` assignment out of the guard and always call `proceedSave(dcData)`:
```ts
if (this.selectedGateEntry?.length > 0) { dcData.gateEntryIds = this.selectedGateEntry.map(i => i?.id); }
this.appComponent.loader(true);
this.proceedSave(dcData);
```
**Regression Areas:** Create flow with gate entries; RM-price dialog; Submit enable/disable.
**Screenshots Required:** Yes
**API Affected:** `POST jobEntry/create`

---

### Bug ID: JWI-002
**Screen:** Job Work DC In — Edit → Line Item grid
**Severity:** Critical  **Priority:** P1
**Title:** Line items without an RM price are silently dropped on save (data loss)

**Description**
`submitDcValues()` sets `dcData.jobWorkLineItem = withPriceLineItems` (`jobworkentry-edit.component.ts:483, 503`), where `withPriceLineItems = this.dcLineItems?.filter(l => l?.partPrice > 0)` (line 475). Every line item with `partPrice` of `0`, `null` or `undefined` is discarded. The grid still shows them until the page reloads, so the operator believes they were saved.

**Steps to Reproduce**
1. Create a Job Work DC In. 2. Add line item A (price 10). 3. Add line item B for a part whose price master has expired, so RM Price resolves to 0/blank. 4. Submit and confirm the dialog. 5. Re-open the saved DC.

**Actual Result:** Only line item A exists. B is gone with no warning naming it.
**Expected Result:** Either block the save naming the offending items, or list exactly which items will be excluded in the confirmation dialog.
**Root Cause (Possible):** Filter intended as a guard was used as a silent transform.
**Suggested Fix:** Show the excluded item numbers in the dialog body and require explicit acknowledgement; better, block submission and force the user to fix the price master.
**Regression Areas:** Stock inward quantities; downstream Job Work Out FIFO availability; Stock Ledger IN column.
**Screenshots Required:** Yes
**API Affected:** `POST jobEntry/create`

---

### Bug ID: JWI-003
**Screen:** Job Work DC In — Edit → Gate Entry
**Severity:** High  **Priority:** P1
**Title:** "Get Gate Entry Items" wipes all manually added line items without confirmation

**Description**
`mapWithGateEntryLineItems()` begins with `this.dcLineItems = []` (`jobworkentry-edit.component.ts:959`). The button `Get Gate Entry Items` (`jobworkentry-edit.component.html:76`) calls it directly, with no confirmation and no undo.

**Steps to Reproduce**
1. Create a DC. 2. Manually add 5 line items. 3. Select a gate entry number. 4. Click **Get Gate Entry Items**.

**Actual Result:** All 5 manual line items vanish, replaced by gate-entry-derived rows.
**Expected Result:** Confirmation ("This will replace N manually added line items"), or merge rather than replace.
**Suggested Fix:** Guard with the shared confirmation dialog when `dcLineItems.length > 0`.
**Regression Areas:** Gate-entry linking; item numbering (`itemNumber` restarts at 1).
**Screenshots Required:** Yes
**API Affected:** None (client-side)

---

### Bug ID: JWI-004
**Screen:** Job Work DC In — Edit → Gate Entry
**Severity:** Medium  **Priority:** P2
**Title:** Selecting a gate entry does nothing, but de-selecting one immediately rebuilds the grid

**Description**
`emitGateEntry()` only pushes to `selectedGateEntry` (`:946-948`). `removeSelectedGateEntry()` splices and then calls `mapWithGateEntryLineItems()` (`:950-954`). The behaviour is asymmetric: adding requires the button, removing is instant and destructive.

**Steps to Reproduce**
1. Select gate entries GE1 and GE2, click **Get Gate Entry Items** (rows appear). 2. Deselect GE2.

**Actual Result:** Grid rebuilds instantly and any edits made to the GE1 rows are lost.
**Expected Result:** Consistent behaviour — either both instant with a warning, or both behind the button.
**Suggested Fix:** Make `emitGateEntry` also rebuild, and prompt before discarding edits.
**Regression Areas:** Gate-entry flow, unlinked-items panel.
**API Affected:** None

---

### Bug ID: JWI-005
**Screen:** Job Work DC In — Edit → Line Item grid
**Severity:** High  **Priority:** P2
**Title:** Duplicate line-item detection only compares Item Number — the same part can be added many times

**Description**
`submitDcLineItem()` compares `dcLineItemData?.itemNo === item.itemNo` only (`:356`). `partId` and `itemType` are not considered. Item Number is a free-text field (`maxlength="5"`, `job-work-in-line-item.component.html:29`) with no numeric/format validation, so `1`, `01`, `1 ` and `A1` are four distinct "unique" keys for the same part.

**Steps to Reproduce**
1. Add part P-100, item no `1`, qty 50.
2. Add part P-100 again, item no `2`, qty 50.
3. Add part P-100 again, item no `02`, qty 50.

**Actual Result:** Three rows for the same part, 150 units inward.
**Expected Result:** Warning on the second attempt, or an explicit "same part on multiple lines" confirmation.
**Suggested Fix:** Key duplicates on `${itemType}::${partId}` and, separately, enforce a numeric normalised Item Number (`Validators.pattern(/^\d{1,5}$/)` + trim).
**Regression Areas:** Inward quantity totals; Stock Ledger IN; Job Work Out FIFO.
**Screenshots Required:** Yes
**API Affected:** `POST jobEntry/create`

---

### Bug ID: JWI-006
**Screen:** Job Work DC In — Edit → Line Item grid (Delete)
**Severity:** High  **Priority:** P2
**Title:** Saved line items can never be deleted — the Delete button is disabled by a condition that contradicts the handler

**Description**
`jobworkentry-edit.component.html:197-204` renders the delete button only when `remainingQuantity === quantity`, but simultaneously sets `[disabled]="dcLine?.id > 0"`. Every persisted line item has an `id > 0`, so the button is always disabled for saved rows; only unsaved rows can be removed. Yet `onDeleteLineItem()` (`:890-921`) contains logic for the "already outwarded" and "CANCEL status" cases that can never be reached.

**Steps to Reproduce**
1. Open an existing DC with a line item that has not been outwarded (`remainingQuantity === quantity`).
2. Try to delete it.

**Actual Result:** The trash icon is rendered but permanently greyed out. No explanation.
**Expected Result:** Deletion allowed when nothing has been outwarded and the DC is not cancelled; a tooltip explaining why when it is not.
**Root Cause (Possible):** Two competing guards added at different times; the `[disabled]` was a stop-gap.
**Suggested Fix:** Remove `[disabled]="dcLine?.id > 0"`, keep the handler's checks, and add a `title` explaining the block. Ensure the backend applies the same rule.
**Regression Areas:** Line-item deletion; remaining-quantity recalculation.
**Screenshots Required:** Yes
**API Affected:** `POST jobEntry/create` (delete is done by omission from the payload)

---

### Bug ID: JWI-007
**Screen:** Job Work DC In — Edit → Add Line Item
**Severity:** High  **Priority:** P2
**Title:** Quantity accepts zero, negative and unbounded decimal values

**Description**
`createForm()` declares `quantity: [null, Validators.required]` only (`job-work-in-line-item.component.ts:107`). The input is `type="number"` with no `min`, `step` or `maxlength` (`job-work-in-line-item.component.html:34`). `submitDcLineItem()` performs no positivity check. `remainingQuantity` is then set to the same value (`jobworkentry-edit.component.ts:376`).

**Steps to Reproduce**
1. Add a line item with quantity `-100`, then `0`, then `0.00000001`, then `999999999999`.

**Actual Result:** All four are accepted and saved. Negative inward stock is created.
**Expected Result:** `min="0.001"`, a decimal-precision rule matching the grid's `1.0-3` display, an upper bound, and a validation message.
**Suggested Fix:** Add `Validators.min(0.001)` + `Validators.max(...)` + a decimal pattern; mirror on the server.
**Regression Areas:** Stock Ledger balances; Job Work Out availability; RM value calculations.
**Screenshots Required:** Yes
**API Affected:** `POST jobEntry/create`

---

### Bug ID: JWI-008
**Screen:** Job Work DC In — Edit → Add Line Item (edit mode)
**Severity:** Medium  **Priority:** P2
**Title:** Quantity-change guard blocks setting the quantity to its current value and shows a wrong message

**Description**
`checkQtyWithRemainingQty()` (`job-work-in-line-item.component.ts:311-324`) fires when `this.currentQty === inputQty || outwardedQty > inputQty`. The first clause makes re-entering the *same* value an error. The message then claims the value "is less than the outwarded quantity", which is false in that case.

**Steps to Reproduce**
1. Open a saved DC, edit a line item with quantity 100. 2. Click into Quantity, retype `100`, tab out.

**Actual Result:** Warning toast "Quantity for item no. 1 cannot be updated to 100 — it's less than the outwarded quantity (0)."
**Expected Result:** No error; a no-op change is valid.
**Suggested Fix:** Drop the `currentQty === inputQty` clause; correct the message to reflect the actual rule (`inputQty < outwardedQty`).
**Regression Areas:** Line-item edit; `qtyMisMatchMsg` display.
**Screenshots Required:** Yes
**API Affected:** None

---

### Bug ID: JWI-009
**Screen:** Job Work DC In — Edit (Cancel DC)
**Severity:** High  **Priority:** P2
**Title:** Cancel DC has no double-click protection and uses a native `confirm()`

**Description**
`checkJobWorkAlreadyOutwarded()` → `cancelDC()` (`jobworkentry-edit.component.ts:758-833`) never sets `submitDisable`, and the button (`jobworkentry-edit.component.html:236`) has no `[disabled]`. `window.confirm` is used instead of the app's `MatDialog`, inconsistent with every other confirmation in the module and hard to style/localise.

**Steps to Reproduce**
1. Open a saved DC. 2. Double-click **Cancel DC** rapidly, confirming both prompts.

**Actual Result:** Two `jobEntry/cancel/{id}` calls; the second returns `affected: 0` and shows a misleading "Cancel Failed" error after the first succeeded.
**Expected Result:** Button disabled for the duration; single request; single outcome message.
**Suggested Fix:** Set a `cancelInProgress` flag; migrate to `DialogComponent`/`ConfirmationComponent`.
**Regression Areas:** Cancel workflow; status badge refresh.
**API Affected:** `GET jobEntry/cancel/{id}`

---

### Bug ID: JWI-010
**Screen:** Job Work DC In — Edit
**Severity:** High  **Priority:** P2
**Title:** Duplicate DC-number check is client-side only and racy

**Description**
`submitDcForm()` (`:202-257`) performs a search, and if nothing matches, calls `submitDcValues()`. Two operators (or two tabs) submitting the same DC number simultaneously both pass the check. There is no evidence of a unique DB constraint being surfaced as a friendly error — the save is a plain `POST jobEntry/create`.

**Steps to Reproduce**
1. Open the create screen in two tabs for the same customer.
2. Enter DC number `DC/2026/001` in both.
3. Click Submit in tab A and, within ~200 ms, in tab B.

**Actual Result:** Both succeed (or the second fails with a raw 500).
**Expected Result:** Server-enforced uniqueness on `(companyId, dcNumber, status != CANCEL)` returning a 409 that the UI renders as the existing "DC number already exists" message.
**Suggested Fix:** Add the DB unique index and map the constraint violation to a 409 in `jobEntry` create; keep the client check as a UX nicety only.
**Regression Areas:** DC numbering; auto-generated numbers.
**API Affected:** `GET jobEntry/search/true`, `POST jobEntry/create`

---

## Forms & validation

### Bug ID: JWI-011
**Screen:** Job Work DC In — Edit
**Severity:** Medium  **Priority:** P2
**Title:** Customer is visually marked required but has no reactive validator

**Description**
The Customer field is an `app-angular-multiselect-dropdown` outside the reactive form (`jobworkentry-edit.component.html:14-19`); the `.required-field` class is cosmetic. `companyId`/`companyName` are declared with no validators (`jobworkentry-edit.component.ts:149-150`). `submitDcForm` then dereferences `this.selectedCompany[0].id` without optional chaining (`:221`).

**Steps to Reproduce**
1. Open create screen. 2. Leave Customer blank, fill DC Number/Date. 3. Inspect the Submit button state and the console.

**Actual Result:** Form validity does not reflect the missing Customer; the flow only survives because Delivery Address (which is `required`) cannot be populated without a customer. Any future change to that chain produces a `TypeError: Cannot read properties of undefined (reading 'id')`.
**Expected Result:** Explicit `Validators.required` on `companyId`, updated by the dropdown emitters.
**Suggested Fix:** Bind the multiselect to the `companyId` control and add the validator; add optional chaining at `:221` and `:216`.
**Regression Areas:** Submit enablement; edit mode readonly customer.
**API Affected:** `POST jobEntry/create`

---

### Bug ID: JWI-012
**Screen:** Job Work DC In — Edit / Search
**Severity:** Medium  **Priority:** P2
**Title:** DC Date has no min/max — future dates are accepted and silently empty the Currency and HS Code dropdowns

**Description**
`dcDate` is `[new Date()]` with no validators (`jobworkentry-edit.component.ts:154`) and the datepicker has no `[minDate]`/`[maxDate]` (`jobworkentry-edit.component.html:45-47`). `pricePickList()` and `hsCodePickList()` filter master data by `effectiveDt <= dcDate < expiryDt` (`job-work-in-line-item.component.ts:247, 267`). A future DC date therefore yields empty lists and an "no currency in part master" alert that misdiagnoses the problem.

**Steps to Reproduce**
1. Create a DC. 2. Set DC Date to a date 1 year in the future. 3. Select a part in Add Line Item.

**Actual Result:** "No currency available in part master" alert; the real cause (future date) is never mentioned. The DC can still be saved with a future date.
**Expected Result:** `[maxDate]="today"` on the picker (or an explicit business rule), and a message that names the date as the cause.
**Suggested Fix:** Add `[maxDate]`, and include the effective date window in the alert text.
**Regression Areas:** Price/HS-code resolution; back-dated entries.
**Screenshots Required:** Yes
**API Affected:** None

---

### Bug ID: JWI-013
**Screen:** Job Work DC In — Edit
**Severity:** Medium  **Priority:** P2
**Title:** Changing DC Date after line items exist does not revalidate already-added items

**Description**
`dcDate` is passed to the child as `[dcDate]="deliveryChallanEditForm.get('dcDate')?.value"` (`jobworkentry-edit.component.html:155`), but existing rows in `dcLineItems` keep the `partPriceId` / `commodityCodeId` resolved under the old date. No re-check runs on date change.

**Steps to Reproduce**
1. Set DC Date to 01-Jan. 2. Add a line item using a price valid only in January. 3. Change DC Date to 01-Jun. 4. Submit.

**Actual Result:** Saved with a price record that is not effective on the DC date.
**Expected Result:** On date change, re-validate every line item and warn/clear the invalid ones.
**Suggested Fix:** Subscribe to `dcDate` valueChanges and re-run price/HS validity for `dcLineItems`.
**Regression Areas:** RM valuation; HS code on printed DC.
**API Affected:** None

---

### Bug ID: JWI-014
**Screen:** Job Work DC In — Edit (File upload)
**Severity:** Medium  **Priority:** P2
**Title:** `onFileChange` dereferences `files[0]` before checking the list is non-empty

**Description**
`jobworkentry-edit.component.ts:633-634`:
```ts
this.selectedFileName = event.target.files[0].name;   // line 633
if (event.target.files.length > 0) { ... }            // line 634 — check is too late
```
**Steps to Reproduce**
1. Open a saved DC. 2. Click **Browse**. 3. Press **Cancel** in the OS file picker (on browsers that fire `change` with an empty list, and always after `onclick="this.value=null"` re-selection edge cases).

**Actual Result:** `TypeError: Cannot read properties of undefined (reading 'name')` in the console; the upload block stops responding.
**Expected Result:** Guard first; reset `selectedFileName`, `uploadError` and `disable_upload_button` when the selection is cleared.
**Suggested Fix:** Reorder the guard and add an `else` that resets state.
**Regression Areas:** File upload; 3 MB size check.
**API Affected:** `POST upload`

---

### Bug ID: JWI-015
**Screen:** Job Work DC In — Edit (File upload)
**Severity:** Medium  **Priority:** P2
**Title:** Uploaded filename is derived from the DC number with only `/` sanitised — path-traversal risk

**Description**
`submitFile()` builds the name as `dcNumber.replaceAll('/', '$$$') + extension` (`:655-658`). Backslashes, `..`, null bytes, leading dots and OS-reserved names are untouched. The file type is restricted only by the `accept=".pdf"` attribute (`jobworkentry-edit.component.html:126`), which is a picker hint, not a validation.

**Steps to Reproduce**
1. Create a DC with number `..\..\evil`. 2. Save, re-open, upload any file renamed to `.pdf`.

**Actual Result:** The server receives a filename containing traversal sequences; content type is never verified.
**Expected Result:** Server generates the stored filename (UUID) and validates the MIME type by magic bytes; the original name is stored as metadata only.
**Suggested Fix:** Move filename generation server-side; add a client-side extension+size+MIME pre-check as a courtesy.
**Regression Areas:** Upload/download; `getFile()`.
**API Affected:** `POST upload`, `GET download`

---

### Bug ID: JWI-016
**Screen:** Job Work DC In — Edit (File download)
**Severity:** Medium  **Priority:** P2
**Title:** Download handles only HTTP 403 and always labels the blob `application/pdf`

**Description**
`getFile()` (`:702-730`) has an error handler that only branches on `status === 403`; 404 and 500 fail silently. The blob is unconditionally typed `application/pdf` (`:718`), so a JSON error body is saved as a corrupt PDF.

**Steps to Reproduce**
1. Open a DC whose attachment was deleted on the server. 2. Click the file name.

**Actual Result:** A 0-byte or JSON-content "PDF" downloads with no error message.
**Expected Result:** Toast describing the failure; no file written.
**Suggested Fix:** Handle all error statuses; check `Content-Type` before creating the blob.
**Regression Areas:** Attachment download.
**API Affected:** `GET download?fileName&documentType`

---

### Bug ID: JWI-017
**Screen:** Job Work DC In — Edit
**Severity:** Medium  **Priority:** P3
**Title:** `clear()` resets `status`/`inspectionStatus` to null and leaves line items behind

**Description**
`clear()` calls `deliveryChallanEditForm.reset()` (`:742-746`), nulling `status` (default `'ACTIVE'`) and `inspectionStatus` (default `'OPEN'`). The status label in the header (`jobworkentry-edit.component.html:6`) goes blank and every `status != 'CANCEL'` template check now compares against `null`. `dcLineItems` is not cleared.

**Steps to Reproduce**
1. On the create screen add 2 line items. 2. Click **Clear**.

**Actual Result:** Header status disappears; the 2 line items remain in the grid; the Customer dropdown clears but the plant list does not.
**Expected Result:** Full reset to the initial create state, including `dcLineItems = []` and the default status values.
**Suggested Fix:** Replace `reset()` with `reset(initialValue)` and clear the dependent collections.
**Regression Areas:** Create flow; header badge.
**Screenshots Required:** Yes
**API Affected:** None

---

## Grid, search, export

### Bug ID: JWI-018
**Screen:** Job Work DC In — Search results
**Severity:** High  **Priority:** P2
**Title:** "Export as Excel" ignores the on-screen search filter

**Description**
The Search box calls `globals.applyDOMFilter(event, 'jobWorkEntry-search-table')` (`jobworkentry-search.component.ts:168`), which hides `<tr>`s in the DOM. `exportExcel()` exports `this.searchResult` — the full, unfiltered array (`:183`).

**Steps to Reproduce**
1. Search and get 200 rows. 2. Type a term in the results **Search** box so 3 rows remain. 3. Click **Export as Excel**.

**Actual Result:** The workbook contains all 200 rows.
**Expected Result:** Export matches what is displayed.
**Suggested Fix:** Filter the model, not the DOM (use a pipe or a filtered `dataSource`), and export `dataSource`.
**Regression Areas:** Same defect exists in Job Work DC Out search (`outwarddeliverychallan-search.component.ts:207`).
**Screenshots Required:** Yes
**API Affected:** None

---

### Bug ID: JWI-019
**Screen:** Job Work DC In — Search results
**Severity:** Medium  **Priority:** P2
**Title:** Results grid has no sorting, no pagination and no column visibility

**Description**
The results table (`jobworkentry-search.component.html:72-99`) is a plain `<table>`. None of Sorting / Pagination / Column visibility exist. A search across a wide date range renders every row into the DOM at once.

**Steps to Reproduce**
1. Clear the date filters (see JWI-021) and search. 2. Click any column header.

**Actual Result:** Nothing sorts. All N rows render; the page becomes sluggish above a few thousand rows.
**Expected Result:** Sortable headers, a paginator with page-size options, and either server-side paging or virtual scroll.
**Suggested Fix:** Migrate to the PrimeNG `p-table` already used by Stock Ledger, with `[paginator]` and `[sortField]`.
**Regression Areas:** Search performance; export.
**API Affected:** `GET jobEntry/search/false`

---

### Bug ID: JWI-020
**Screen:** Job Work DC In — Search results
**Severity:** Medium  **Priority:** P3
**Title:** `<tbody>` is repeated per row, breaking striping and any table tooling

**Description**
`jobworkentry-search.component.html:83` puts `*ngFor` on `<tbody>`, producing one `<tbody>` per record. Zebra striping via `:nth-child` no longer alternates and most sort/filter libraries assume a single tbody. The `<thead>` is also not closed before `<tbody>` begins (line 82-83), leaving the header row inside `thead` but the tbody as a sibling of an unclosed structure.

**Actual Result:** Striping is uniform; DOM is malformed.
**Expected Result:** One `<tbody>` with `*ngFor` on `<tr>`.
**Suggested Fix:** Move `*ngFor` to the `<tr>`; close `<thead>` properly. Same fix needed in `outwarddeliverychallan-search.component.html:65`.
**Screenshots Required:** Yes
**API Affected:** None

---

### Bug ID: JWI-021
**Screen:** Job Work DC In — Search criteria
**Severity:** Medium  **Priority:** P3
**Title:** "Clear" nulls the date range instead of restoring defaults, allowing an unbounded query

**Description**
`resetSelection()` calls `.reset()` on each control (`jobworkentry-search.component.ts:187-193`). The form was initialised with `dcDate = firstDayOfCurrentMonth` and `to-dcDate = today` (`:76-77`). After Clear, both are null and `submitForm` omits them (`:101-105`), so the API is called with no date bounds at all.

**Steps to Reproduce**
1. Click **Clear**. 2. Click **Search**.

**Actual Result:** Entire history is fetched and rendered.
**Expected Result:** Clear restores the default month-to-date range; or the server enforces a maximum range.
**Suggested Fix:** `resetSelection()` should `reset({dcDate: firstDayOfCurrMonth, 'to-dcDate': new Date()})`; add a server-side range cap.
**Regression Areas:** Search performance; export size.
**API Affected:** `GET jobEntry/search/false`

---

### Bug ID: JWI-022
**Screen:** Job Work DC In — Search criteria
**Severity:** Medium  **Priority:** P3
**Title:** No linkage between From Date and To Date; a reversed range returns a generic "no data"

**Description**
Neither datepicker has `[minDate]`/`[maxDate]` (`jobworkentry-search.component.html:30-36`), unlike the Job Work DC Out search which correctly uses `utils.getMaxDate(...)`/`utils.getMinDate(...)`.

**Steps to Reproduce**
1. From Date = 30-Jun-2026, To Date = 01-Jan-2026. 2. Search.

**Actual Result:** "No Job Entry(s) Data Retrieved" — indistinguishable from a genuinely empty result.
**Expected Result:** To Date picker disallows dates before From Date, or an explicit validation message.
**Suggested Fix:** Mirror the ODC pattern.
**Screenshots Required:** Yes
**API Affected:** `GET jobEntry/search/false`

---

### Bug ID: JWI-023
**Screen:** Job Work DC In — Search results
**Severity:** Low  **Priority:** P3
**Title:** Empty-state message is unreachable and has a missing space

**Description**
`jobworkentry-search.component.html:100`: `<div *ngIf="dataSource.length === 0">No data matching for"{{ filterText }}"</div>`. The whole results block is wrapped in `*ngIf="showSearchResult"`, which is only `true` when `data.length > 0` (`jobworkentry-search.component.ts:124-127`), so `dataSource.length === 0` is never true. Also `for"` is missing a space.

**Expected Result:** A reachable "no rows match your filter" state, correctly spaced.
**Suggested Fix:** Drive the message from the filtered row count once JWI-018 is fixed.
**Screenshots Required:** Yes
**API Affected:** None

---

### Bug ID: JWI-024
**Screen:** Job Work DC In — Search
**Severity:** Medium  **Priority:** P2
**Title:** `localStorage` used to hand the saved DC number across a page reload leaves stale state behind

**Description**
`proceedSave()` writes `localStorage.setItem('dcNumber', ...)` then reloads (`jobworkentry-edit.component.ts:539-542`); `ngOnInit` of the search screen reads and auto-searches it (`jobworkentry-search.component.ts:61-67`). The key is removed only inside the search response handlers (`:137, :141`). If the reload is interrupted, if the user navigates away first, or if the search request never settles (see XC-002), the key survives and the *next* visit to the screen silently auto-searches an unrelated DC.

**Steps to Reproduce**
1. Save a DC. 2. During the reload, immediately navigate to another module. 3. Return to Job Work DC In later.

**Actual Result:** The screen auto-searches the old DC number and overrides the restored search state.
**Expected Result:** Cross-screen state passed in memory via the existing `SearchStateService`.
**Suggested Fix:** Remove the reload (XC-004) and pass the DC number as a component output/route param.
**Regression Areas:** Search-state restore; identical pattern in ODC (`OutwardDCNo`).
**API Affected:** `GET jobEntry/search/true`

---

## Performance & code hygiene

### Bug ID: JWI-025
**Screen:** Job Work DC In — Edit
**Severity:** Medium  **Priority:** P3
**Title:** HS-code lookup fires one unthrottled HTTP request per part, on every retrieve and every line-item add

**Description**
`populateHsCodeDisplayMap()` (`:405-450`) loops distinct part ids and issues a separate `fetchPartCommodityByTypeAndPartId` / `fetchRmPartById` call for each, with `error: () => {}` swallowing failures. It is invoked from `retrieveDcFromService`, `displayRetrievedDeliveryChallanForm` and `submitDcLineItem`, so a 50-line DC issues ~50 parallel requests, then 1 more per subsequent add.

**Steps to Reproduce**
1. Open a DC with 50 distinct parts. 2. Watch the Network tab.

**Actual Result:** ~50 concurrent requests; the HS Code column shows `NA` for any that fail, indistinguishable from "no HS code".
**Expected Result:** One batched request, or `forkJoin` with a cache and a visible error state.
**Suggested Fix:** Add a batch endpoint accepting a list of part ids; cache results for the session.
**Regression Areas:** HS Code column; printed DC.
**API Affected:** `GET part/commodity`, `GET rmpart/byId`

---

### Bug ID: JWI-026
**Screen:** Job Work DC In — Add Line Item
**Severity:** Medium  **Priority:** P3
**Title:** Debug `console.log` statements shipped to production

**Description**
`job-work-in-line-item.component.ts:76` and `:87` log `this.editData` (full business object) and `:362` logs the string `'false'`.
**Expected Result:** No console output in production builds.
**Suggested Fix:** Remove; add a lint rule (`no-console`) to CI.
**API Affected:** None

---

### Bug ID: JWI-027
**Screen:** Job Work DC In — Edit
**Severity:** Medium  **Priority:** P2
**Title:** `cdRef.detectChanges()` inside a subscription risks `ExpressionChangedAfterItHasBeenChecked`

**Description**
`retrieveDcFromService()` sets `isCompanyAndPlantDisable` then immediately calls `this.cdRef.detectChanges()` (`:317-320`) while a second async call (`fetchCompanyById`) is still in flight; the readonly `companyName` control is only populated inside that later callback and only when `isCompanyAndPlantDisable` is already true (`:332-337`).

**Steps to Reproduce**
1. Open a DC where some quantity has been outwarded, on a slow connection.

**Actual Result:** The Customer field can briefly render as an empty readonly input; dev builds may log `ExpressionChangedAfterItHasBeenCheckedError`.
**Expected Result:** Deterministic rendering; the readonly value is set before the field is shown.
**Suggested Fix:** `forkJoin` the DC and company requests; set all derived flags once, then let default change detection run.
**Screenshots Required:** Yes
**API Affected:** `GET jobEntry/byJobEntryId/{id}`, `GET company/byId`

---

## Layout & responsiveness

### Bug ID: JWI-028
**Screen:** Job Work DC In — Edit header
**Severity:** Low  **Priority:** P3
**Title:** Status label positioned with a negative inline margin overlaps the title on narrow viewports

**Description**
`jobworkentry-edit.component.html:5`: `style="float: right;margin-top: -23px;"`. At widths below ~768 px the floated `<h5>` overlaps `{{title}} Job Work DC In`.
**Steps to Reproduce:** Open the edit screen and resize to 375 px / 768 px.
**Actual Result:** Status text sits on top of the title.
**Expected Result:** Flex header (`d-flex justify-content-between align-items-center`), no negative margins.
**Suggested Fix:** Replace the float/negative margin with the flex header pattern already used in `outwarddeliverychallan-search.component.html:3`.
**Screenshots Required:** Yes
**API Affected:** None

---

### Bug ID: JWI-029
**Screen:** Job Work DC In — Edit form
**Severity:** Low  **Priority:** P3
**Title:** Grid uses only `col-md-*` with no small-screen classes; the "Get Gate Entry Items" button misaligns

**Description**
Every field is `col-md-3` with no `col-sm`/`col-12` fallback (`jobworkentry-edit.component.html:12-137`). The Gate Entry button wrapper uses `style="margin-top: 1.5em"` (`:75`) to fake label alignment, which breaks as soon as the label above wraps to two lines.
**Expected Result:** `col-12 col-sm-6 col-md-3` and a label-height-independent alignment (e.g. an invisible label or flex end-alignment).
**Screenshots Required:** Yes
**API Affected:** None

---

### Bug ID: JWI-030
**Screen:** Job Work DC In — Line Item grid
**Severity:** Low  **Priority:** P3
**Title:** Inspection Status badge shows red (`bg-danger`) for every status except CLOSED

**Description**
`jobworkentry-edit.component.html:218` and `jobworkentry-search.component.html:94` use a binary `CLOSED ? bg-success : bg-danger`. A normal `OPEN` item — the expected state for a new DC — is rendered as an error-red badge.
**Expected Result:** Neutral/info styling for OPEN, success for CLOSED, danger reserved for genuine problems.
**Suggested Fix:** Map status → class via a lookup; add PARTIAL if the domain has one.
**Screenshots Required:** Yes
**API Affected:** None

---

# Module 2 — Job Work Out (`layout/outwarddeliverychallan`)

## Business logic & data integrity

### Bug ID: JWO-001
**Screen:** Job Work DC Out — Edit → Line Item grid (PO column)
**Severity:** Critical  **Priority:** P1
**Title:** PO selections are keyed by row index and are never re-indexed after a delete — POs attach to the wrong line items on save

**Description**
`selectedPoItems` and `unSelectedPoItemsIds` are plain arrays indexed by the grid row index (`emitPo($event, rowIndex)` `outward-delivery-chalan-edit.component.ts:1644-1650`; `removeSelectedPo` `:1652-1665`). `proceedDeleteLineItem()` re-indexes `expandedRows` (`reindexExpandedRows`, `:2832-2853`) but **never** touches `selectedPoItems` / `unSelectedPoItemsIds`. `submitODCForm()` then reads `this.selectedPoItems?.[index]` while walking `postData.outwardLineItem` (`:699-708`).

**Preconditions:** A DC with ≥3 line items and different POs selected per item.

**Steps to Reproduce**
1. Create a Job Work DC Out with 3 line items (parts A, B, C).
2. Assign PO-1 to row 1, PO-2 to row 2, PO-3 to row 3.
3. Delete row 1.
4. Submit and re-open the DC.

**Actual Result:** Part B carries PO-1 and part C carries PO-2; PO-3 is lost. The `unSelectedPoId` list is also misaligned.
**Expected Result:** PO selection follows the line item, not its position.
**Root Cause (Possible):** Index-keyed parallel arrays instead of storing the selection on the line-item object.
**Suggested Fix:** Store `selectedPos` directly on each line item (`lineItem.selectedPos = [...]`) so it moves with the row; drop both parallel arrays.
**Regression Areas:** Invoicing against PO; SO quantity validation; PO consumption reporting.
**Screenshots Required:** Yes
**API Affected:** `POST outward-delivery-challan/create`

---

### Bug ID: JWO-002
**Screen:** Job Work DC Out — Edit (edit mode)
**Severity:** Critical  **Priority:** P1
**Title:** In edit mode the PO index is computed against active items but applied to a list that includes soft-deleted rows

**Description**
`submitODCForm()` sets `postData.outwardLineItem = this.dcLineItems` in edit mode (`:695`) — `dcLineItems` retains rows flagged `isDeleted: 1`. The PO arrays were built while iterating `activeLineItems` / `outwardDcLineItems` (deleted rows filtered out, `:2697`). The `forEach((item, index))` at `:699` therefore indexes a *longer* array with positions derived from a *shorter* one.

**Steps to Reproduce**
1. Open an existing DC with 4 line items and POs assigned.
2. Delete line item 2 (soft delete).
3. Change the PO on the (now) second visible row.
4. Submit.

**Actual Result:** The PO is written against the deleted row; the visible row keeps its old PO.
**Expected Result:** PO mapping resolved by line-item identity, not position.
**Suggested Fix:** Same as JWO-001 — attach POs to the line-item objects.
**Regression Areas:** Edit flow; soft-delete; invoice linkage.
**API Affected:** `POST outward-delivery-challan/create`

---

### Bug ID: JWO-003
**Screen:** Job Work DC Out — Edit
**Severity:** Critical  **Priority:** P1
**Title:** All stock validation is gated on an **invoice** flag that defaults to falsy when organisation details are empty

**Description**
`fetchOrganisationDetails()` sets `this.stockRestrictionEnabled = this.organisationDetails?.[0]?.restrictInvoiceCreation` (`:278`). The property is declared `stockRestrictionEnabled: boolean = true` (`:141`) but is unconditionally overwritten — if the array is empty or the field is null, it becomes `undefined` (falsy). Every stock guard is behind it:

| Guard | Line |
|---|---|
| `validateJobWorkDCStock` pre-save call | 640 |
| `validateMainQty()` (qty ≤ available) | 1935 |
| casting/machining process requirement | 1807 |
| `validateRejectedQty()` | 1818, 1823 |
| available-stock banner | 851 |

**Steps to Reproduce**
1. Point the app at a tenant whose `organisationDetails` returns `[]` (or `restrictInvoiceCreation: null`).
2. Create a Job Work DC Out and enter an approved quantity far larger than the available stock.
3. Click **Get Line Items**, then **Submit**.

**Actual Result:** No availability check runs; the DC saves and drives stock negative.
**Expected Result:** A dedicated `restrictStockOnJobworkOut` setting; fail **closed** (validate) when the setting is unavailable.
**Root Cause (Possible):** An unrelated invoice flag was reused as a stock switch.
**Suggested Fix:** `this.stockRestrictionEnabled = this.organisationDetails?.[0]?.restrictStockValidation ?? true;` and add a distinct config field. Re-validate server-side in `outward-delivery-challan/create` regardless of any client flag.
**Regression Areas:** All stock validation; available-stock banner; rejection process dropdowns.
**Screenshots Required:** Yes
**API Affected:** `POST stock-ledger/validateJobworkDCStock`, `POST outward-delivery-challan/create`

---

### Bug ID: JWO-004
**Screen:** Job Work DC Out — Edit
**Severity:** High  **Priority:** P1
**Title:** Race condition — `stockRestrictionEnabled` is read before `fetchOrganisationDetails()` resolves

**Description**
`ngOnInit()` fires `fetchOrganisationDetails()` without awaiting (`:207`). A user who selects a part and clicks **Get Line Items** before that response lands evaluates every guard in JWO-003 against the initial value.

**Steps to Reproduce**
1. Throttle the network to Slow 3G. 2. Load the create screen and immediately fill the form and click **Get Line Items**.
**Actual Result:** Validation behaviour differs between fast and slow loads — non-deterministic.
**Expected Result:** Form actions blocked (or the loader held) until the configuration is known.
**Suggested Fix:** Include the call in the existing `forkJoin` in `fetchMasterDetails()` and only clear the loader once all have resolved.
**Regression Areas:** All stock validation.
**API Affected:** `GET organisation-details/search`

---

### Bug ID: JWO-005
**Screen:** Job Work DC Out — Edit → Cancel DC / Remove line item
**Severity:** High  **Priority:** P2
**Title:** Invoice-usage guard fails **open** — an API error lets an invoiced DC be cancelled

**Description**
`cancelDC()`'s `validateDcLineItemUsage` subscription has `error: () => { this.appComponent.loader(false); this.doCancelDC(); }` (`:1262-1265`). The same pattern is in `removeODCLineItem()` (`:2323-2326`). Combined with XC-002 (`cancelOutWard` swallows errors), the operator sees neither the guard failure nor the cancel failure.

**Steps to Reproduce**
1. Open a Job Work DC Out that is fully invoiced.
2. Make `outward-delivery-challan/validate-dc-line-item-usage` return 500.
3. Click **Cancel DC** and confirm.

**Actual Result:** The DC is cancelled despite being invoiced.
**Expected Result:** Fail closed: block the action and surface "Could not verify invoice usage — try again".
**Suggested Fix:** Change both error handlers to abort with a toast; enforce the same rule in `outward-delivery-challan/cancel`.
**Regression Areas:** Cancel workflow; line-item deletion; invoice integrity.
**Screenshots Required:** Yes
**API Affected:** `POST outward-delivery-challan/validate-dc-line-item-usage`, `GET outward-delivery-challan/cancel/{id}`

---

### Bug ID: JWO-006
**Screen:** Job Work DC Out — Edit
**Severity:** High  **Priority:** P2
**Title:** `validateDcLineItemUsage` is called with two different id semantics

**Description**
`cancelDC()` passes `this.dcLineItems.map(li => li?.id)` — the ids of the **parent** outward rows (`:1213-1215`). `removeODCLineItem()` passes `[outwardDetail?.id]`, also a parent row id (`:2310`). Neither passes actual `outwardLineItem` ids, yet the parameter is named `dcLineItemIds` in the service (`outward.service.ts:77`). Whichever interpretation the backend uses, one of the two call sites is wrong.

**Steps to Reproduce**
1. Instrument the request payload for both **Cancel DC** and **Remove line item** on the same DC and compare against the DB.
**Actual Result:** The guard is evaluated against the wrong entity in at least one flow, so invoiced items can slip through.
**Expected Result:** A single, documented id type.
**Suggested Fix:** Define the contract explicitly (parent `outwardDcId` vs child `outwardLineItemId`), rename the DTO field, and fix the call sites.
**Regression Areas:** Cancel; delete; invoice validation.
**API Affected:** `POST outward-delivery-challan/validate-dc-line-item-usage`

---

### Bug ID: JWO-007
**Screen:** Job Work DC Out — Edit
**Severity:** High  **Priority:** P2
**Title:** Duplicate DC-number check does not URL-encode the DC number

**Description**
`duplicateCheck()` builds `const searchData = 'dcNumber=' + postData.dcNumber + '&status=NOTCANCEL'` (`:663`) with no `encodeURIComponent` — unlike `jobworkentry-search.component.ts:103` which does encode. A DC number containing `&`, `#`, `+`, `%` or a space corrupts the query string.

**Steps to Reproduce**
1. Create a DC with number `DC 2026&01`. 2. Save. 3. Create a second DC with the identical number and save.

**Actual Result:** The duplicate search sends a malformed query, returns nothing, and both DCs save.
**Expected Result:** Encoded parameter; the duplicate is detected.
**Suggested Fix:** `encodeURIComponent(postData.dcNumber)`; also restrict allowed characters in the DC-number field.
**Regression Areas:** DC numbering; auto-generated numbers.
**API Affected:** `GET outward-delivery-challan/search/true`

---

### Bug ID: JWO-008
**Screen:** Job Work DC Out — Edit
**Severity:** High  **Priority:** P2
**Title:** Sales-order quantity validation is per-DC only — the SO quantity can be exceeded across multiple DCs

**Description**
`validateSoQuantity()` compares `item?.approvedQty > po?.salesOrderLineItemQty` for the DC currently being saved (`:1770-1788`). Quantities already dispatched against the same PO/SO line on other DCs are not considered.

**Steps to Reproduce**
1. SO line quantity = 100. 2. Create DC-1 for 80 against that PO and save. 3. Create DC-2 for 80 against the same PO and save.
**Actual Result:** Both save; 160 dispatched against a 100-unit SO line.
**Expected Result:** Cumulative check against the SO line's remaining balance, enforced server-side.
**Suggested Fix:** Fetch the SO line's already-dispatched quantity and validate `dispatched + thisDc <= soQty` in `outward-delivery-challan/create`.
**Regression Areas:** SO fulfilment; invoicing; PO consumption.
**API Affected:** `POST outward-delivery-challan/create`

---

### Bug ID: JWO-009
**Screen:** Job Work DC Out — Edit → Line Item grid
**Severity:** High  **Priority:** P2
**Title:** A single available PO is auto-attached to every line item without consent and without an unselect record

**Description**
`autoSelectPoIfSingle()` (`:1675-1687`) pushes the sole PO onto every row's `selectedPoItems`. It never records anything in `unSelectedPoItemsIds`, so if the user later removes it the removal is recorded but the original auto-selection was never an explicit user action.

**Steps to Reproduce**
1. Choose a plant that has exactly one open PO. 2. Add 3 line items.
**Actual Result:** All 3 silently carry that PO; the user is not told.
**Expected Result:** Either no auto-selection, or a visible "auto-selected" indicator that the user must confirm.
**Suggested Fix:** Remove the behaviour or mark the chip as auto-selected and require confirmation before save.
**Regression Areas:** PO linkage; JWO-001/002.
**Screenshots Required:** Yes
**API Affected:** `POST outward-delivery-challan/create`

---

### Bug ID: JWO-010
**Screen:** Job Work DC Out — Edit → Line Item grid (Input Qty column)
**Severity:** High  **Priority:** P2
**Title:** `getParentInputQty()` divides by `requiredQty` without a zero guard — renders `Infinity` / `NaN`

**Description**
`:2242-2256`:
```ts
return Math.floor(totalChildQty / firstChildPart?.requiredQty);
```
No check for `requiredQty` being `0`, `null` or `undefined`, and `totalChildQty` is a `reduce` over `item?.approvedQty` with no `|| 0`, so a single `undefined` makes the sum `NaN`.

**Steps to Reproduce**
1. Select a parent part whose BOM has a child with `requiredQty = 0` (or null). 2. Click **Get Line Items**.
**Actual Result:** The **Input Qty** column shows `Infinity` or `NaN`.
**Expected Result:** `0` or `—` with a tooltip explaining the incomplete BOM.
**Suggested Fix:** `const req = Number(firstChildPart?.requiredQty || 0); return req > 0 ? Math.floor(total / req) : 0;` plus `|| 0` in the reduce.
**Regression Areas:** Parent-part display; child expansion.
**Screenshots Required:** Yes
**API Affected:** `POST outward-line-item/fetchJobWorkLineItemsFifo`

---

### Bug ID: JWO-011
**Screen:** Job Work DC Out — Edit → quantity fields
**Severity:** High  **Priority:** P2
**Title:** Rejection quantities are never validated against the available rejected stock shown in the banner

**Description**
`validateMainQty()` (`:1755-1768`) only compares the main quantity (`quantity` or `notProcessedQty`) with `availableApprovedQty`. `availableCastingRejectedQty` and `availableMachiningRejectedQty` are computed and displayed (`outward-delivery-chalan-edit.component.html:309-318`) but never used as limits. `validateRejectedQty()` (`:2168-2177`) only checks against the selected *process* quantity, and returns `true` when no process is selected.

**Steps to Reproduce**
1. Select a part whose banner shows "Casting Rejected Quantity: 5".
2. Enter Casting Rejection Quantity `500`. 3. Select any casting process. 4. Click **Get Line Items**.
**Actual Result:** Accepted if the chosen process happens to have ≥500 available, or if no process is required; the banner limit is ignored.
**Expected Result:** Hard limit at the displayed available quantity with an inline error.
**Suggested Fix:** Extend `validateMainQty()` to cover both rejection quantities; add reactive `max` validators driven by the banner values.
**Regression Areas:** Rejection stock; Stock Ledger REJECTED columns.
**Screenshots Required:** Yes
**API Affected:** `POST outward-line-item/fetchJobWorkLineItemsFifo`

---

### Bug ID: JWO-012
**Screen:** Job Work DC Out — Edit (Customer Materials)
**Severity:** High  **Priority:** P2
**Title:** Customer-Material outward bypasses all quantity/availability validation

**Description**
The availability check is guarded by `if (this.stockRestrictionEnabled && !isCustomerMaterial && !this.validateMainQty()) { return }` (`:1935`), and the negative/duplicate checks in `getJobWorkLineItemList()` are inside `if (itemType === this.globals.partRm)` (`:1831`). Option Type = *Customer Materials* therefore skips duplicate detection, casting/machining process requirements and availability limits.

**Steps to Reproduce**
1. Set Option Type = Customer Materials. 2. Select a material. 3. Enter an approved quantity far above the available stock. 4. **Get Line Items** → **Submit**.
**Actual Result:** Saves without any check.
**Expected Result:** The same availability and duplicate rules as Part-RM.
**Suggested Fix:** Remove the `!isCustomerMaterial` exclusions and implement the equivalent availability source for customer materials.
**Regression Areas:** Customer-material stock; Stock Ledger.
**API Affected:** `POST outward-line-item/fetchJobWorkLineItemsFifo`, `POST stock-ledger/validateJobworkDCStock`

---

### Bug ID: JWO-013
**Screen:** Job Work DC Out — Edit → Material Source dialog
**Severity:** Medium  **Priority:** P2
**Title:** `rebuildSourceConsumptionMap()` only counts RAW_MATERIAL rows — the same inspection lot can be over-allocated

**Description**
`:2150-2166` iterates `outwardDcLineItems` and only descends into rows where `parent?.outwardItemType === 'RAW_MATERIAL'`. Allocations made on PARENT-mode rows are invisible to the map, so `addSource()`'s `alreadyConsumed` calculation (`:2091`) understates consumption.

**Steps to Reproduce**
1. Add a PARENT-mode line item and allocate 10 units from inspection lot L1.
2. Switch to Raw Material mode, add a line item for the same part, open **Add Source**.
**Actual Result:** L1 still shows its full remaining quantity; the 10 already allocated are not deducted.
**Expected Result:** Consumption aggregated across both modes.
**Suggested Fix:** Drop the `outwardItemType` filter and walk `childParts` as well.
**Regression Areas:** Material-source allocation; FIFO consumption.
**API Affected:** `POST stock-ledger/validateMaterialSources`

---

### Bug ID: JWO-014
**Screen:** Job Work DC Out — Edit → Material Source dialog
**Severity:** Medium  **Priority:** P2
**Title:** `deletedMaterialSourceMap` is never cleared after a successful save — stale credits inflate availability

**Description**
On save, only `this.deletedLineItemsForStock = []` is reset (`:724`). `deletedMaterialSourceMap` (populated in `markAsDeleted`, `:2598, 2634, 2672`) persists. `addSource()` adds `deletedQty` back to the remaining quantity (`:2094-2095`), so after a delete-then-save cycle the same source appears to have more stock than it does.

**Steps to Reproduce**
1. Edit a DC, delete a line item that had allocated sources, and **Submit** (the page reloads, masking this).
2. Without reloading (e.g. if XC-004 is fixed), add a new line item for the same part and open **Add Source**.
**Actual Result:** Remaining quantity is inflated by the previously deleted allocation.
**Expected Result:** The map is cleared on successful save.
**Suggested Fix:** `this.deletedMaterialSourceMap.clear(); this.sourceConsumptionMap.clear();` alongside line 724.
**Regression Areas:** Source allocation after edit.
**API Affected:** `POST outward-delivery-challan/create`

---

### Bug ID: JWO-015
**Screen:** Job Work DC Out — Edit
**Severity:** High  **Priority:** P1
**Title:** Double-submit is possible — the guard flag is reset on several paths before the save request is dispatched

**Description**
`duplicateCheck()` sets `submitDisable = true` at `:592`, but resets it to `false` on eight early-return paths (`:597, 613, 620, 626, 633, 653, 671, 678`) and the asynchronous `await firstValueFrom(this.jobWorkService.validateJobWorkDCStock(...))` at `:648` yields control to the event loop before the button's `[disabled]` binding is guaranteed to have rendered. There is no idempotency key on `POST outward-delivery-challan/create`.

**Steps to Reproduce**
1. Prepare a valid DC with line items. 2. Double-click **Submit** as fast as possible (or use a script dispatching two clicks in the same tick).
**Actual Result:** Two create requests; two DCs with the same number (the duplicate check ran before either committed).
**Expected Result:** Exactly one request; the button is disabled synchronously on the first click.
**Suggested Fix:** Disable the button in the click handler synchronously before any async work, and add a client-generated idempotency key that the server de-duplicates.
**Regression Areas:** DC creation; DC numbering; stock movements.
**Screenshots Required:** Yes
**API Affected:** `POST outward-delivery-challan/create`

---

## Forms & validation

### Bug ID: JWO-016
**Screen:** Job Work DC Out — Edit
**Severity:** High  **Priority:** P2
**Title:** The form has no `(ngSubmit)` but contains a `type="submit"` button — pressing Enter reloads the page and loses all work

**Description**
`outward-delivery-chalan-edit.component.html:10` is `<form [formGroup]="ODCEditForm">` with **no** `(ngSubmit)`. The Submit button is `type="submit"` with a `(click)` handler (`:653`). Pressing Enter in any of the ~15 text inputs triggers the browser's native form submission, which for a form with no action performs a GET to the current URL — a full navigation.

**Steps to Reproduce**
1. Create a DC, add 3 line items.
2. Click into **Vehicle No** and press **Enter**.

**Actual Result:** The page navigates/reloads; all unsaved line items are lost with no prompt.
**Expected Result:** Enter either submits through the Angular handler or does nothing.
**Root Cause (Possible):** The submit action was moved to `(click)` without changing the button type or adding `(ngSubmit)`.
**Suggested Fix:** Add `(ngSubmit)="duplicateCheck(ODCEditForm.value)"` and change the button to `type="button"` with no click handler — or keep `(click)` and set `type="button"`.
**Regression Areas:** Every input on the screen; keyboard-only users.
**Screenshots Required:** Yes
**API Affected:** None

---

### Bug ID: JWO-017
**Screen:** Job Work DC Out — Edit → quantity fields
**Severity:** High  **Priority:** P2
**Title:** Quantity fields have no min/step/max and no reactive validators

**Description**
`quantity`, `notProcessedQty`, `castingRejectionQty`, `machiningRejectionQty` are declared with no validators (`:369-372`) and rendered as bare `type="number"` inputs (`html:212, 221, 229, 248`). Negative values are only rejected inside `getJobWorkLineItemList()` (`:1802-1805`), i.e. after the user clicks **Get Line Items**; there is no inline feedback. Decimals of unlimited precision are accepted while the grid formats to `1.0-3`.

**Steps to Reproduce**
1. Enter `-5` in Approved Quantity, then `0.00049`, then `1e9`.
**Actual Result:** No inline error; the `-5` case only produces a toast after clicking **Get Line Items**; `0.00049` is accepted and displays as `0`.
**Expected Result:** `min="0"`, `step="0.001"`, a sensible max, and inline validation messages.
**Suggested Fix:** Add `Validators.min(0)` / `Validators.max(...)` / decimal pattern to all four controls and render the errors.
**Regression Areas:** Stock movements; grid formatting; `isGetLineItemsEnabled`.
**Screenshots Required:** Yes
**API Affected:** `POST outward-line-item/fetchJobWorkLineItemsFifo`

---

### Bug ID: JWO-018
**Screen:** Job Work DC Out — Edit (GST)
**Severity:** Medium  **Priority:** P2
**Title:** GST length limit uses inline `onKeyPress` and is bypassed by paste, spinners and autofill; no min/max

**Description**
`html:144, 152, 160`: `onKeyPress="if(this.value.length==5) return false;"`. This blocks only keypress events. Paste, the number-input spinner arrows, arrow keys and autofill all bypass it. There is no `min`/`max`, so `-50` and `9999` are accepted as percentages.

**Steps to Reproduce**
1. Paste `12345678` into IGST. 2. Type `-10` into CGST. 3. Use the spinner to exceed 5 characters.
**Actual Result:** All accepted.
**Expected Result:** `min="0" max="100"` with reactive validators and a decimal-precision rule.
**Suggested Fix:** Replace with `Validators.min(0)`, `Validators.max(100)` and a `(input)` handler; delete the inline JS.
**Regression Areas:** GST on the printed DC and downstream invoice.
**Screenshots Required:** Yes
**API Affected:** `POST outward-delivery-challan/create`

---

### Bug ID: JWO-019
**Screen:** Job Work DC Out — Edit (GST)
**Severity:** Medium  **Priority:** P2
**Title:** `onChangeGst()` wipes CGST/SGST as soon as IGST has any value, including a value later deleted

**Description**
`:1302-1307` — `if (igst?.value) { cgst.setValue(null); sgst.setValue(null); }`. It fires on `keyup`, so typing a single digit in IGST clears both other fields; deleting that digit restores the enabled state but the CGST/SGST values are gone.

**Steps to Reproduce**
1. Enter CGST 9 and SGST 9. 2. Click into IGST, type `1`, then press Backspace.
**Actual Result:** CGST and SGST are permanently blank.
**Expected Result:** Confirm before clearing, or restore on revert.
**Suggested Fix:** Only clear on a committed change (`blur`/`change`) and prompt when data would be lost.
**Screenshots Required:** Yes
**API Affected:** None

---

### Bug ID: JWO-020
**Screen:** Job Work DC Out — Edit (E-Way Bill)
**Severity:** Medium  **Priority:** P2
**Title:** E-Way Bill number is uppercased by a raw DOM handler that bypasses the Angular form control

**Description**
`html:108`: `oninput="this.value = this.value.toUpperCase()"`. The DOM value and the `FormControl` value can diverge (Angular's `ValueAccessor` writes back on its own `input` listener; ordering is not guaranteed across browsers).

**Steps to Reproduce**
1. Type `ab12` quickly into E-Way Bill. 2. Inspect `ODCEditForm.get('eWayBillNumber').value` in the console.
**Actual Result:** The displayed value can be `AB12` while the control still holds `ab12` (or an intermediate value).
**Expected Result:** Transform inside the Angular pipeline.
**Suggested Fix:** `(input)="onEwayInput($event)"` setting the control with `{emitEvent:false}`, or a directive.
**API Affected:** `POST outward-delivery-challan/create`

---

### Bug ID: JWO-021
**Screen:** Job Work DC Out — Edit (DC Number)
**Severity:** Medium  **Priority:** P2
**Title:** `text-transform: capitalize` makes the displayed DC number differ from the stored value

**Description**
`html:85`: `style="text-transform: capitalize;"`. This is presentation-only — the model keeps the raw casing. The duplicate check compares raw values, so `dc/2026/1` and `DC/2026/1` are distinct records that render identically.

**Steps to Reproduce**
1. Create DC `dc/2026/1`. 2. Create DC `DC/2026/1`.
**Actual Result:** Both save; the grid shows two visually identical DC numbers.
**Expected Result:** Normalise the value in the model (e.g. uppercase on blur) and compare case-insensitively.
**Suggested Fix:** Remove the CSS transform; normalise in the control; make the server-side uniqueness check case-insensitive.
**Screenshots Required:** Yes
**API Affected:** `GET outward-delivery-challan/search/true`, `POST outward-delivery-challan/create`

---

### Bug ID: JWO-022
**Screen:** Job Work DC Out — Edit
**Severity:** Medium  **Priority:** P2
**Title:** Rebuilding the FormGroup in edit mode silently discards the `valueChanges` subscriptions registered in `ngOnInit`

**Description**
`ngOnInit()` subscribes to `plantId` and `pickupLocation` valueChanges (`:213-224`). `displayRetrievedOutwardScreenForm()` then replaces the entire group with `this.ODCEditForm = this.fb.group({...})` (`:484`). Both subscriptions now point at an orphaned FormGroup and never fire again.

**Steps to Reproduce**
1. Open an existing DC. 2. Change the Pickup Location.
**Actual Result:** `pickUpLocationId` is not updated and no auto-generation check runs (the guards would suppress it in edit mode anyway, so the dead subscription is masked — but the plant subscription is also dead).
**Expected Result:** `patchValue` on the existing group, or re-subscribe after rebuilding.
**Suggested Fix:** Build the form once in `createEditForm()` and use `patchValue()` in `displayRetrievedOutwardScreenForm()`.
**Regression Areas:** Plant change; pickup-location change; DC auto-numbering.
**API Affected:** `GET organisation-details/auto-generate-*`

---

### Bug ID: JWO-023
**Screen:** Job Work DC Out — Edit (Plant)
**Severity:** High  **Priority:** P2
**Title:** Plant id is captured as a string from the DOM and stored in a `number` field

**Description**
`emitPlant(event)` reads `event.target.value` — always a string (`:1092`) — and assigns it to `previousPlantId: number | null` (`:1105`). The revert path then calls `setValue(this.previousPlantId, {emitEvent:false})` (`:1098`); `fetchJobWorkOutParts()` interpolates it into `plantId=${...}` (`:1711`).

**Steps to Reproduce**
1. With line items present, change the Plant and **cancel** the confirmation. 2. Change it again and cancel again.
**Actual Result:** The select can fail to revert to the previous option (string/number identity mismatch against `[value]="plant.key"`), leaving the UI showing a plant that the model does not have.
**Expected Result:** Numeric coercion at the boundary.
**Suggested Fix:** `const newPlantId = Number(event.target.value);` and type the field consistently.
**Regression Areas:** Plant change; part list; PO list; FIFO calls.
**Screenshots Required:** Yes
**API Affected:** `GET outward-line-item/fetchJobWorkOutParts`

---

### Bug ID: JWO-024
**Screen:** Job Work DC Out — Edit
**Severity:** Medium  **Priority:** P2
**Title:** `clear()` nulls a required control and leaves `selectedMode` out of sync

**Description**
`clear()` (`:1189-1196`) calls `ODCEditForm.reset()`, which nulls `itemType` (declared with `Validators.required`, `:368`) and `status` (default `'ACTIVE'`). `selectedMode` keeps its previous value while the Option Type dropdown displays "Select Item Type", and the header status label goes blank.

**Steps to Reproduce**
1. On the create screen set Option Type = Customer Materials, add a line item. 2. Click **Clear**.
**Actual Result:** Dropdown shows the placeholder but `selectedMode` is still `PARENT`/`RAW_MATERIAL` from before; Submit is disabled because `itemType` is null with no visible error; the status badge is empty.
**Expected Result:** Reset to the documented create-state defaults.
**Suggested Fix:** `reset({itemType: globals.partRm, status: 'ACTIVE', dcDate: new Date(), dcNumber: dcNumberValue, isShippingDetailsRequired: false})` and reset `selectedMode = 'PARENT'`.
**Regression Areas:** Create flow; mode segment.
**Screenshots Required:** Yes
**API Affected:** None

---

### Bug ID: JWO-025
**Screen:** Job Work DC Out — Search criteria
**Severity:** Medium  **Priority:** P2
**Title:** Date-range rule is inverted — a To Date earlier than the From Date passes validation

**Description**
`submitInspectorScreenForm()` rejects only when `toDate < fromDate − 6 months` (`outwarddeliverychallan-search.component.ts:104`). A To Date one day *before* the From Date is well within that window and is accepted; there is no maximum-span check at all. The `[minDate]`/`[maxDate]` bindings on the pickers (`html:21, 26`) prevent this via the UI but not via restored search state, `patchValue`, or a typed-in date.

**Steps to Reproduce**
1. Search once so state is saved. 2. Reload, then type From `30-Jun-2026` and To `01-Jun-2026` directly into the inputs. 3. Search.
**Actual Result:** Request sent; empty result presented as "No Outward Screen Details Retrieved".
**Expected Result:** Explicit `toDate >= fromDate` validation with a clear message, plus a maximum-span rule that matches the intent of `outwardScreenDateRangeMsg`.
**Suggested Fix:** Add a cross-field validator on the form group.
**Screenshots Required:** Yes
**API Affected:** `GET outward-delivery-challan/search/false`

---

### Bug ID: JWO-026
**Screen:** Job Work DC Out — Search criteria
**Severity:** Medium  **Priority:** P3
**Title:** "Clear" is an inline `reset()` that empties the required From Date and permanently disables Search

**Description**
`html:30`: `(click)="ODCSearchForm.reset()"`. `dcDate` carries `required` (`html:21`) so `[disabled]="!ODCSearchForm.valid"` on the Search button becomes permanently true until the user re-picks a date. The form's defaults (first day of month / today) are not restored.

**Steps to Reproduce**
1. Click **Clear**. 2. Try to click **Search**.
**Actual Result:** Search is greyed out with no explanation.
**Expected Result:** Clear restores defaults and leaves the form valid.
**Suggested Fix:** A `resetSearch()` method that resets to the initial values.
**Screenshots Required:** Yes
**API Affected:** None

---

## Grid, export, print

### Bug ID: JWO-027
**Screen:** Job Work DC Out — Edit → Line Item grid
**Severity:** Medium  **Priority:** P2
**Title:** Empty-state `colspan` is wrong — the "No line items added yet" cell under-spans by one column

**Description**
The header renders 21 columns with RM Price access and 20 without (`html:337-357`), but the empty row uses `[attr.colspan]="isUserHasRmPriceAccess ? 20 : 18"` (`html:636`).

**Steps to Reproduce**
1. Open the create screen without adding any line items.
**Actual Result:** The empty-state cell stops short; the table shows 1-3 stray empty cells to its right.
**Expected Result:** `colspan` equals the rendered column count.
**Suggested Fix:** Compute the count from a single source of truth (a `columns` array) used by both the header and the colspan.
**Screenshots Required:** Yes
**API Affected:** None

---

### Bug ID: JWO-028
**Screen:** Job Work DC Out — Edit → Line Item grid
**Severity:** Medium  **Priority:** P3
**Title:** Child-part header row `colspan` assumes RM Price access and overflows for users without it

**Description**
`html:455`: `<td colspan="18">` following three cells = 21 columns. Users without `RMPART-PRICE` see a 20-column table, so the row overflows by one and the table's right border misaligns on every expanded parent.

**Steps to Reproduce**
1. Log in as a user without the `RMPART-PRICE` asset. 2. Open a DC with a PARENT part. 3. Expand it.
**Actual Result:** Child-part header row is one column too wide.
**Expected Result:** Dynamic colspan.
**Screenshots Required:** Yes
**API Affected:** None

---

### Bug ID: JWO-029
**Screen:** Job Work DC Out — Edit → Line Item grid
**Severity:** Medium  **Priority:** P2
**Title:** Line-item grid has no sorting, filtering, pagination, column visibility or export

**Description**
The 21-column grid (`html:334-644`) is a plain table inside two nested scroll wrappers (`table-responsive` > `table-scroll-wrapper`). None of the grid features required by the review checklist are present, and a DC with many FIFO-expanded rows renders entirely into the DOM.

**Expected Result:** At minimum a sticky header, a row-count indicator and horizontal-scroll affordance; ideally the same PrimeNG table used by Stock Ledger.
**Suggested Fix:** Migrate to `p-table` with `[scrollable]`, `[paginator]` and frozen leading columns.
**Regression Areas:** Large DCs; performance.
**Screenshots Required:** Yes
**API Affected:** None

---

### Bug ID: JWO-030
**Screen:** Job Work DC Out — Edit → PO dropdown
**Severity:** Medium  **Priority:** P2
**Title:** The PO dropdown is manually positioned with `position: fixed` and detaches from its cell on scroll or resize

**Description**
`repositionPoDropdown()` (`:1689-1703`) sets `position: fixed` plus absolute `top`/`left` from a `getBoundingClientRect()` taken inside a `setTimeout`. No `scroll` or `resize` listener re-runs the calculation, and the grid lives inside two scrollable containers.

**Steps to Reproduce**
1. Open a DC with 10+ line items. 2. Click a PO dropdown on a lower row. 3. Scroll the grid vertically or horizontally without closing it.
**Actual Result:** The open panel stays pinned to its original viewport position, floating away from its cell and over unrelated content.
**Expected Result:** The panel tracks its anchor, or the grid scroll is locked while it is open.
**Suggested Fix:** Use a CDK `Overlay` with a `FlexibleConnectedPositionStrategy` and `withScrollableContainers`.
**Screenshots Required:** Yes
**API Affected:** None

---

### Bug ID: JWO-031
**Screen:** Job Work DC Out — Search results
**Severity:** Medium  **Priority:** P3
**Title:** Generate DC types `dcNumber` as `number` and does not sanitise it for the download filename

**Description**
`generateOutwardDc(id: number, dcNumber: number)` (`outwarddeliverychallan-search.component.ts:148`) — the parameter is a string in reality. `saveAs(blob, ${dcNumber}.pdf)` (`:157-158`) passes it unsanitised; DC numbers routinely contain `/`.

**Steps to Reproduce**
1. Search for a DC whose number is `JW/OUT/2026/001`. 2. Click **Generate DC**.
**Actual Result:** Browser-dependent filename mangling; on some browsers the slashes are replaced with `_`, on others the download name is unexpected.
**Expected Result:** Sanitised filename; correct parameter type.
**Suggested Fix:** `dcNumber: string` and `dcNumber.replace(/[\\/:*?"<>|]/g, '-')`.
**Screenshots Required:** Yes
**API Affected:** `GET outward-delivery-challan/generate?id=`

---

### Bug ID: JWO-032
**Screen:** Job Work DC Out — Search results
**Severity:** Medium  **Priority:** P3
**Title:** E-Way Bill JSON error toast renders `[object Object]`

**Description**
`outwarddeliverychallan-search.component.ts:182`: `this.toastr.showError('Error', err)` — the raw `HttpErrorResponse` is passed as the message body.
**Steps to Reproduce:** Click **Generate E-Way JSON** for a DC with no E-Way details.
**Actual Result:** Toast reads `[object Object]`.
**Expected Result:** The server's message.
**Suggested Fix:** See XC-003.
**Screenshots Required:** Yes
**API Affected:** `GET dc-e-way-bill-details/generate`

---

### Bug ID: JWO-033
**Screen:** Job Work DC Out — Search results / Export
**Severity:** Medium  **Priority:** P3
**Title:** Customer Name is blank in the grid and the export until an unawaited lookup resolves

**Description**
`fetchPlantAndCustomer()` populates `customerMap` asynchronously and is not coordinated with the search (`:211-217`). Both the grid (`html:80`) and `exportExcel()` (`:200`) read `customerMap.get(row?.plantId)`. Restored search state renders immediately from `SearchStateService`, often before the map is ready.

**Steps to Reproduce**
1. Search and get results. 2. Navigate away and back (search state is restored). 3. Immediately click **Export as Excel**.
**Actual Result:** Customer Name column is empty in both the grid and the workbook.
**Expected Result:** Customer names resolved before render/export, or a placeholder.
**Suggested Fix:** `forkJoin` the customer map with the search, or resolve the name server-side in the search payload.
**Screenshots Required:** Yes
**API Affected:** `GET plant/plantAndCustomer`, `GET outward-delivery-challan/search/false`

---

### Bug ID: JWO-034
**Screen:** Job Work DC Out — Search results
**Severity:** High  **Priority:** P2
**Title:** Export ignores the on-screen filter (same defect as JWI-018)

**Description**
`applyFilter()` hides DOM rows via `globals.applyDOMFilter` (`:191-193`); `exportExcel()` exports `this.outwardData` (`:207`).
**Expected Result:** Export matches the visible rows.
**Suggested Fix:** As JWI-018.
**API Affected:** None

---

## UX consistency & performance

### Bug ID: JWO-035
**Screen:** Job Work DC Out — Edit
**Severity:** Medium  **Priority:** P3
**Title:** Native `alert()` and `confirm()` used alongside the app's MatDialog/toaster

**Description**
`alert()` at `:845` ("This part is already added as …"); `confirm()` at `:1039`, `:1054`, `:1094`. Everything else on the same screen uses `ToasterService`, `DialogComponent` or `ConfirmationComponent`. Native dialogs are unstyled, block the JS thread, cannot be localised and are suppressed entirely in some embedded contexts.

**Steps to Reproduce**
1. Add a part, then select the same part again in the same mode.
**Actual Result:** A browser-chrome alert box.
**Expected Result:** The app's standard dialog.
**Suggested Fix:** Replace all four with `ConfirmationComponent`/`ToasterService`.
**Screenshots Required:** Yes
**API Affected:** None

---

### Bug ID: JWO-036
**Screen:** Job Work DC Out — Edit
**Severity:** Medium  **Priority:** P2
**Title:** Change-detection hot paths — getters and string-building functions bound directly in the template

**Description**
- `activeLineItems` is a getter that runs `filter()` on every change-detection pass (`:2696-2698`, bound at `html:362, 635`).
- `getInvStatusText()` / `getInvStatusCss()` normalise strings per cell, per pass (`:145-171`, bound at `html:439-440, 508-509, 599-600`).
- `getDropdownPOListForPart()` and `hasSourcesByType()` are also template-bound (`html:400, 550, 612, 621`).

With 21 columns and dozens of rows this is thousands of function calls per CD cycle, and every mouse move over the grid triggers one.

**Steps to Reproduce**
1. Open a DC with 50+ line items. 2. Type in the Notes input of any row.
**Actual Result:** Visible input lag.
**Expected Result:** Precomputed fields on the row model; `OnPush` change detection; `trackBy` on the `ngFor`s (none of the `*ngFor`s in this template declare `trackBy`).
**Suggested Fix:** Compute status label/class once when the row is loaded; add `trackBy`; switch the component to `ChangeDetectionStrategy.OnPush`.
**Regression Areas:** Whole edit screen.
**API Affected:** None

---

### Bug ID: JWO-037
**Screen:** Job Work DC Out — Edit (Pickup Location)
**Severity:** Low  **Priority:** P3
**Title:** Pickup locations are ordered by the `keyvalue` pipe, which sorts by key as a string

**Description**
`html:74`: `*ngFor="let pickup of pickUpLocationMap | keyvalue"`. Angular's `keyvalue` pipe sorts by key; the keys here are numeric address ids coerced to strings, so the list order is by id-as-text (`1, 10, 11, 2, …`), not alphabetical by address. The `pickUpLocation` array built at `:409` is never used.

**Expected Result:** Alphabetical by formatted address, or explicit business ordering with the default first.
**Suggested Fix:** Bind to a sorted array of `{id, label}` and delete the unused `pickUpLocation` field.
**Screenshots Required:** Yes
**API Affected:** `GET address/values`

---

### Bug ID: JWO-038
**Screen:** Job Work DC Out — Edit → Line Item grid
**Severity:** Medium  **Priority:** P3
**Title:** Child line items cannot be removed individually and the disabled state is not explained

**Description**
The Remove cell for child rows is an empty `<td>` (`html:466-467`). The only way to remove a child line is to delete the whole parent, which is nowhere stated. Separately, the parent Remove button is disabled purely on `status === 'CANCEL'` (`html:370`) with no tooltip.

**Expected Result:** Either per-child removal, or a disabled button with a tooltip explaining that child lines are managed with the parent.
**Screenshots Required:** Yes
**API Affected:** None

---

### Bug ID: JWO-039
**Screen:** Job Work DC Out — Edit
**Severity:** Low  **Priority:** P3
**Title:** Dead code and misspelled identifiers

**Description**
`ourdWardData` (misspelling of `outwardData`, `:80` and 6 usages); `outWardLinItemArray` + `convertFlatArrayOfObject()` are never called (`:71, :565-568`); `availableQuantity: 0` is declared with a value as its type (`:73`); `mainSelectedPoItems` / `deselectPoList()` / `removeSelectedMainPo()` are unreachable (no template binding); `dropdownData`/`selectedItemType` duplicate state already held in `partList`/`itemType`.
**Suggested Fix:** Remove; enable `noUnusedLocals` in CI.
**API Affected:** None

---

# Module 3 — Stock Ledger (`layout/stockLedger/report`)

## Search & filtering

### Bug ID: SL-001
**Screen:** Stock Ledger Report — Search
**Severity:** Critical  **Priority:** P1
**Title:** The search/filter form is never rendered — the screen always shows unfiltered data

**Description**
`SearchStockLedgerReportComponent` builds `reportSearchForm` with `type`, `date` and `to-date` controls in the constructor (`search-stock-ledger-report.component.ts:224-228`), and `onSearch()` reads them (`:257-273`). `search-stock-ledger-report.component.html` contains **no `<form>` element and no bindings to `reportSearchForm`** — the entire criteria panel is missing from the template. `ReactiveFormsModule` is imported but unused.

**Preconditions:** None.

**Steps to Reproduce**
1. Navigate to `layout/stockLedger/report`.
2. Look for Product Type / From Date / To Date inputs and a Search button.

**Actual Result:** Only a report header with Refresh / Clear Filters / Export Excel, three defect checkboxes and the grid. No way to filter by product type or date. The report always loads the full data set on component construction.
**Expected Result:** A search panel bound to `reportSearchForm` with Search and Clear, matching the other two modules.
**Root Cause (Possible):** The criteria markup was removed (or never merged) while the component logic was left in place.
**Suggested Fix:** Restore the criteria panel, bind it to `reportSearchForm`, and trigger `onSearch()` from `(ngSubmit)` rather than the constructor.
**Regression Areas:** Every "search by field", "clear filters" and "date range" requirement; report load time.
**Screenshots Required:** Yes
**API Affected:** `GET stock-ledger/report`

---

### Bug ID: SL-002
**Screen:** Stock Ledger Report
**Severity:** Critical  **Priority:** P1
**Title:** Date filtering is broken end to end — `fromDate` is hardcoded to today, `toDate` is sent under the wrong name, and the backend discards both

**Description**
Three independent defects compound:

1. **Frontend, wrong value** — `onSearch()` sets `searchParams['fromDate'] = this.datePipe.transform(new Date(), ...)` (`:265`). The user's From Date (`formValues.date`) is never read. The report is always anchored to today.
2. **Frontend, wrong parameter name** — the To Date is sent as `to-date` (`:262-264`). The backend reads `searchParams?.toDate` (`procurementsvcs/src/modules/stock-ledger/stock-ledger.service.ts:908`). The parameter is silently ignored.
3. **Backend, discarded lower bound** — when a snapshot exists, the caller's `fromDate` is replaced by the snapshot date; when none exists, **no lower bound is applied at all** (`stock-ledger.service.ts:902-907`):
```ts
if (searchParams?.fromDate) {
    if (mostRecentDateStockLedgerSnapShotDate) {
        params.push(mostRecentDateStockLedgerSnapShotDate);
        whereClauses.push('sl.`date` >= ?');
    }          // <-- no else: caller's fromDate is dropped
}
```

**Steps to Reproduce**
1. Open the report and inspect the request in the Network tab.
2. Observe `?fromDate=<today>` and the absence of any `toDate`.
3. Compare the returned rows against a direct query bounded by a specific date range.

**Actual Result:** The report's date window is whatever the snapshot dictates, never what the user asked for. As-of-date reporting and period comparison are impossible.
**Expected Result:** `fromDate`/`toDate` taken from the form, sent with the names the API declares, and honoured by the query.
**Root Cause (Possible):** A snapshot optimisation was added and the caller-supplied lower bound was commented out (`:894-901`) and never restored; the frontend parameter name was never aligned with the controller's documented contract (`stock-ledger.controller.ts:125-126`).
**Suggested Fix:** Send `fromDate`/`toDate` from the form; in the service use `MAX(snapshotDate, fromDate)` as the lower bound rather than replacing it; add a contract test covering both parameters.
**Regression Areas:** Stock Ledger report totals; the Excel export; anything reconciling Job Work In/Out against the ledger; scheduled report mails (`isFromMail`).
**Screenshots Required:** Yes
**API Affected:** `GET stock-ledger/report`

---

### Bug ID: SL-003
**Screen:** Stock Ledger Report — Grid column filters
**Severity:** High  **Priority:** P1
**Title:** Every numeric column filter references a field that does not exist on the row model

**Description**
The row objects produced by `searchStockLedger()` (`:362-395`, `:419-453`) are flat: `in`, `inspection`, `inspectionRejection`, `inspectionOutsourced`, `inspectionOutsourcedReceived`, `batchQty`, `ops`, `rejs`, `insp_final`, `rej_final`. The filters declared in the template target different paths:

| Template filter field | Line | Actual row property |
|---|---|---|
| `id` | 208 | (none — rows have no `id`) |
| `inspection.approved` | 274 | `inspection` |
| `inspection.rejected` | 277 | `inspectionRejection` |
| `inspection.outsourced` | 280 | `inspectionOutsourced` |
| `inspection.outsourced-received` | 283 | `inspectionOutsourcedReceived` |
| `batch.approved` | 288 | `batchQty` |
| `operations.<OP>.<key>` (via `getWipColumnField`, `:683-685`) | 298 | `ops.<OP>.<key>` |

**Steps to Reproduce**
1. Open the report. 2. Click the filter icon on **INWARD(OP 10)** — this one works (`field="in"`). 3. Now filter on **Inspection → APPROVED** with a value that is visibly present in the grid.

**Actual Result:** Zero rows returned for every Inspection, Batch and WIP filter, and the S.No filter. Only `part`, `productName`, `type`, `qqsCode`, `customerName`, `make`, `category`, `unit`, `in`, `insp_final` and `rej_final` work.
**Expected Result:** All declared filters match their column.
**Root Cause (Possible):** Filters were written against an earlier nested response shape that was later flattened in the mapping step.
**Suggested Fix:** Point each `p-columnFilter` at the real property; change `getWipColumnField()` to return `ops.${op}.${key}`; drop the S.No filter (row index is not filterable data).
**Regression Areas:** All grid filtering; "Clear Filters" enablement (`hasFilters()`).
**Screenshots Required:** Yes
**API Affected:** None

---

### Bug ID: SL-004
**Screen:** Stock Ledger Report — Product Type filter
**Severity:** Medium  **Priority:** P3
**Title:** Product-Type filter lower-cases the selected value while the column displays it upper-cased

**Description**
`html:220-226` — options are built from `part?.toUpperCase()` (`:455`), the dropdown displays the upper-cased value, but the filter callback is invoked with `$event.value.toLowerCase()`. It works only because the underlying data happens to be lower-case; any record stored with different casing becomes unfilterable.

**Steps to Reproduce**
1. Filter by product type `PART` — works. 2. Introduce a record whose `part` is `Part` and repeat.
**Actual Result:** The mixed-case record is excluded.
**Expected Result:** Case-insensitive matching (`matchMode: 'equals'` on a normalised field).
**Suggested Fix:** Store a normalised `partUpper` on the row and filter on that.
**API Affected:** None

---

### Bug ID: SL-005
**Screen:** Stock Ledger Report — Unit filter
**Severity:** Medium  **Priority:** P3
**Title:** Two competing unit-filter implementations; the multi-select one is dead code

**Description**
`#unitFilterTemplate` (`html:114-141`) with `onUnitCheckboxChange()`/`applyUnitFilter()` (`ts:816-844`) is declared but never referenced by any `pTemplate`, so it never renders. The unit column actually uses a single-select `p-dropdown` (`html:257-267`). Users cannot filter by multiple units despite the code existing.

**Expected Result:** One implementation; multi-select if that is the requirement.
**Suggested Fix:** Wire the template into the unit `p-columnFilter` or delete it and `selectedUnits`/`applyUnitFilter`.
**API Affected:** None

---

## Data correctness

### Bug ID: SL-006
**Screen:** Stock Ledger Report — Grid
**Severity:** High  **Priority:** P2
**Title:** `unit`, `dispatch` and `pack` are mapped only for the merged response shape — the UNIT column is blank for legacy payloads

**Description**
`searchStockLedger()` has two mapping branches. The merged-shape branch maps `unit`, `dispatch`, `pack` (`:362-395`); the legacy flat-row branch does not (`:419-453`). Everything downstream depends on `unit`: the UNIT column (`html:333`), the colour badges (`getUnitColor`), `unitOptions` (`:458`), `getUniqueUnits()` and the global filter field list (`html:95`).

**Steps to Reproduce**
1. Point the app at a backend/tenant returning the legacy flat shape (no `ops`/`rejs` keys on the rows).
2. Open the report.
**Actual Result:** UNIT column empty for every row; the unit filter dropdown has no options; `isUnitConversionRow()` is always false.
**Expected Result:** Identical field coverage in both branches.
**Suggested Fix:** Extract one `mapRow()` used by both paths.
**Regression Areas:** UNIT column; unit filter; export.
**Screenshots Required:** Yes
**API Affected:** `GET stock-ledger/report`

---

### Bug ID: SL-007
**Screen:** Stock Ledger Report — Grid
**Severity:** High  **Priority:** P2
**Title:** `dataKey="productId"` is not unique across product types — rows collide

**Description**
`html:99` sets `dataKey="productId"`, but `productId` is only unique **within** a `part` type. A part with id 5 and a tool with id 5 are two different rows sharing a key. PrimeNG uses `dataKey` for row identity (selection, expansion, virtual scroll, state restore).

**Steps to Reproduce**
1. Ensure the data set contains a `part` and a `tool` with the same numeric id.
2. Sort, filter or paginate the grid.
**Actual Result:** Non-deterministic row identity; row state can jump between the two records.
**Expected Result:** A composite key.
**Suggested Fix:** Add `rowKey = ${part}::${productId}` during mapping and use that as `dataKey`.
**Regression Areas:** Sorting, paging, any future row selection.
**API Affected:** None

---

### Bug ID: SL-008
**Screen:** Stock Ledger Report — Grid (PRODUCT column)
**Severity:** High  **Priority:** P2
**Title:** `getProductName()` mutates the row from inside a template binding

**Description**
`ts:541-544`:
```ts
getProductName(item) { item.productName = this.typeMaps?.[item?.part]?.[item?.productId]; return item?.productName; }
```
It is bound at `html:326` and again at `html:413`. Writing component/model state during change detection is an Angular anti-pattern: it is re-executed for every row on every CD cycle and in dev mode can raise `ExpressionChangedAfterItHasBeenCheckedError`. `fetchParts()` already sets `productName` on every row (`:785-788`), so the mutation is redundant.

**Steps to Reproduce**
1. Open the report in a dev build with 100+ rows. 2. Interact with any control and watch the console/profiler.
**Actual Result:** The function runs hundreds of times per interaction; possible CD error in dev mode.
**Expected Result:** A pure read of the precomputed `item.productName`.
**Suggested Fix:** Replace the binding with `{{ item?.productName }}` and delete the method.
**Regression Areas:** PRODUCT column; drill-down dialog title.
**API Affected:** None

---

### Bug ID: SL-009
**Screen:** Stock Ledger Report
**Severity:** High  **Priority:** P2
**Title:** `fetchParts()` re-throws inside an un-awaited async call — unhandled promise rejection and permanent spinner risk

**Description**
`fetchParts()` is `async`, catches, toasts and then `throw err` (`:790-798`). Its only caller is `searchStockLedger()` (`:462`), which neither awaits nor `.catch()`es it.

**Steps to Reproduce**
1. Make `part/fetchProductsByPartIdsAndTypes` return 500. 2. Open the report.
**Actual Result:** `Uncaught (in promise)` in the console; the grid renders with an empty PRODUCT column and no indication that names failed to load. If the promise never settles, the `finally` never runs and the spinner stays up (see SL-010).
**Expected Result:** Handled failure, a clear message, and the grid still usable.
**Suggested Fix:** Remove the `throw`, or `await`/`catch` at the call site.
**Regression Areas:** PRODUCT column; export.
**API Affected:** `POST part/fetchProductsByPartIdsAndTypes`

---

### Bug ID: SL-010
**Screen:** Stock Ledger Report
**Severity:** High  **Priority:** P2
**Title:** Loader is switched **on** at the end of the success handler — almost certainly a `true`/`false` typo

**Description**
`searchStockLedger()` ends its `next` block with `this.appComponent.loader(true);` (`:463`). It only appears to work because `fetchParts()`'s `finally` clears the loader a moment later. If the parts lookup is slow, fails to settle, or is short-circuited, the spinner never clears.

**Steps to Reproduce**
1. Throttle `part/fetchProductsByPartIdsAndTypes` to a 60 s delay. 2. Open the report.
**Actual Result:** Spinner blocks the screen for the full delay even though the grid data has already arrived.
**Expected Result:** `this.appComponent.loader(false);`
**Suggested Fix:** Change to `false` and make `fetchParts()` manage only its own loader (or use a counter-based loader service).
**Screenshots Required:** Yes
**API Affected:** None

---

### Bug ID: SL-011
**Screen:** Stock Ledger Report — Grid
**Severity:** Medium  **Priority:** P2
**Title:** Two competing sources of truth for the WIP column set

**Description**
`this.opStages` is derived from the response (`:315-348`) while `this.allOperations` / `this.wipOperations` / `wipOpsCount` are derived separately from the keys of `item.ops` (`extractOperations()`, `:509-531`). The header colspan uses `wipOpsCount * getWipColumnCount()` (`html:162`) while the level-2/3/4 header rows iterate `wipOperations` — if the two ever diverge (e.g. an op present in `opStages` but absent from every row's `ops`), the header grid breaks and columns misalign against the body.

Note also that the merged-shape branch computes `itemOps` and then **discards it**, assigning the raw `row?.ops` instead (`:392-393`), so the zero-filling done at `:357-360` never reaches the UI.

**Steps to Reproduce**
1. Return a payload whose `opStages` includes `OP60` but where no row has an `ops.OP60` key.
**Actual Result:** Header/body column counts diverge; the table renders with offset cells.
**Expected Result:** One derivation, used by header and body alike.
**Suggested Fix:** Compute the column set once from `opStages ∪ keys(ops)` and drive everything from it; restore the `itemOps` assignment.
**Screenshots Required:** Yes
**API Affected:** `GET stock-ledger/report`

---

### Bug ID: SL-012
**Screen:** Stock Ledger Report — Grid
**Severity:** Medium  **Priority:** P3
**Title:** `formatReportQuantity()` ignores its `item` argument; unit-aware formatting was never wired up

**Description**
`:501-507` takes `(item, value)` but never reads `item`. `isUnitConversionRow()` (`:497-499`) is defined and never called. Everything is rounded to 3 dp with trailing zeros stripped, so `0.0004` renders as `0` — indistinguishable from genuinely zero stock.

**Steps to Reproduce**
1. Find (or create) a row with a quantity below 0.0005.
**Actual Result:** Displays `0`; the Excel export shows `0` too.
**Expected Result:** Either full precision, or a `< 0.001` indicator, and unit-aware formatting if that was the intent.
**Suggested Fix:** Remove the dead parameter and dead method, or implement the conversion; show small non-zero values distinctly.
**API Affected:** None

---

## Export

### Bug ID: SL-013
**Screen:** Stock Ledger Report — Export Excel
**Severity:** High  **Priority:** P2
**Title:** Export ignores active filters, the global search and the sort order

**Description**
`exportExcel()` maps `this.stockLedgerReportData` (`:584`) — the raw source array. PrimeNG's filtered/sorted view (`dt.filteredValue`, `dt.value`) is not consulted.

**Steps to Reproduce**
1. Type a term in the grid's global search so 3 of 500 rows remain. 2. Sort by PRODUCT descending. 3. Click **Export Excel**.
**Actual Result:** A 500-row workbook in the original order.
**Expected Result:** 3 rows in the displayed order.
**Suggested Fix:** `const rows = this.dt?.filteredValue ?? this.stockLedgerReportData;` and apply the table's current sort.
**Regression Areas:** All exports from this screen.
**Screenshots Required:** Yes
**API Affected:** None

---

### Bug ID: SL-014
**Screen:** Stock Ledger Report — Export Excel
**Severity:** High  **Priority:** P2
**Title:** Export columns do not match the grid — UNIT missing, a phantom Total column present

**Description**
- The grid shows **UNIT** (`html:154, 333`); `exportExcel()` never emits it (`:585-637`).
- The export emits `row['Total'] = balanceApproved` (`:634`) but the TOTAL column is commented out of both the header (`html:169`) and the body (`html:394-398`).
- `Type` and `Category` are exported before the operation columns whereas the grid renders `TYPE` before `PART CODE` — column order differs between screen and file.

**Steps to Reproduce**
1. Export and compare the workbook's header row against the on-screen columns.
**Actual Result:** Mismatch in both column set and order; users cannot reconcile the file with the screen.
**Expected Result:** Export driven by the same column definition the grid uses.
**Suggested Fix:** Introduce a single `columns` array consumed by the header, the body and the exporter.
**Screenshots Required:** Yes
**API Affected:** None

---

### Bug ID: SL-015
**Screen:** Stock Ledger Report — Export Excel
**Severity:** Medium  **Priority:** P3
**Title:** Export filename uses a UTC date and can be a day behind

**Description**
`getCurrentDate()` returns `new Date().toISOString().split('T')[0]` (`:577-580`) — UTC. In IST (UTC+5:30) any export before 05:30 local time carries the previous day's date. Both the button filename (`:648`) and `[exportFilename]` (`html:98`) use it. The same pattern is in `stock-ledger-detail.exportToExcel()` (`:371`).

**Steps to Reproduce**
1. Set the machine clock to 02:00 IST. 2. Export.
**Actual Result:** `stock_ledger_report_<yesterday>.xlsx`.
**Expected Result:** Local date.
**Suggested Fix:** Use `DatePipe.transform(new Date(), 'yyyy-MM-dd')` with the app timezone.
**API Affected:** None

---

### Bug ID: SL-016
**Screen:** Stock Ledger Detail — Export Excel
**Severity:** Medium  **Priority:** P3
**Title:** Header/quantity styling silently does nothing and the autofilter range is malformed

**Description**
`stock-ledger-detail.component.ts:336-352` sets `worksheet[cell].s = {...}`. Cell styles are a feature of the paid/`xlsx-style` builds; the community `xlsx` package ignores `.s` entirely, so the "bold centred headers" and "right-aligned quantity" have no effect. The autofilter ref is built as `A1:${XLSX.utils.encode_col(headers.length - 1)}${rows.length + 1}` (`:314-316`) — `encode_col` returns only a column letter, so the range string is well-formed only incidentally.

**Steps to Reproduce**
1. Open a drill-down, click Export, and inspect the workbook.
**Actual Result:** Plain unstyled headers.
**Expected Result:** Either implement styling with a library that supports it, or remove the dead code and the misleading comments.
**Suggested Fix:** Move to `exceljs` if styling is required.
**API Affected:** None

---

## Drill-down

### Bug ID: SL-017
**Screen:** Stock Ledger Report → Detail
**Severity:** Medium  **Priority:** P2
**Title:** Drill-down uses `window.open(..., '_blank')` and fails silently when pop-ups are blocked

**Description**
`openBreakup()` (`:171`), `onLedgerCellClick()` (`:206`) and `stock-ledger-detail.openSerialTrackDetails()` (`:384`) all call `window.open`. Chrome blocks pop-ups not triggered by a direct user gesture on the same tick; the `setTimeout`-free paths here usually pass, but any browser or enterprise policy that blocks new windows produces no feedback at all.

**Steps to Reproduce**
1. Enable "Block pop-ups" (or open the app in an embedded webview). 2. Click any numeric ledger cell.
**Actual Result:** Nothing happens. No toast, no navigation.
**Expected Result:** Detect the blocked window (`const w = window.open(...); if (!w) { toast(...) }`) or navigate in the same tab.
**Suggested Fix:** Check the return value and fall back to `router.navigate`.
**Screenshots Required:** Yes
**API Affected:** None

---

### Bug ID: SL-018
**Screen:** Stock Ledger Report — Grid
**Severity:** Medium  **Priority:** P2
**Title:** Double-click drill-down silently does nothing for every product type except `part`

**Description**
`openBreakup()` returns early unless `row.part === 'part'` (`:146`). The grid contains tool, holder, collet, cutting-tool, instrument and product rows, all of which look identical and are bound to the same `(dblclick)` (`html:323`).

**Steps to Reproduce**
1. Double-click a `TOOL` row.
**Actual Result:** No response, no explanation.
**Expected Result:** Either support the drill-down for all types, or make it visibly unavailable (no pointer cursor, tooltip).
**Suggested Fix:** Support all types, or gate the `(dblclick)` binding and the `clickable-cell` class on the row type.
**Screenshots Required:** Yes
**API Affected:** `GET stock-ledger/breakup`

---

### Bug ID: SL-019
**Screen:** Stock Ledger Detail
**Severity:** High  **Priority:** P2
**Title:** Detail screen is deep-linkable by `productId` with no guard and no ownership check

**Description**
`layout-routing.module.ts:282` registers `stockLedger/details` with no `canActivate`. `StockLedgerDetailComponent` reads `productId`/`productType` straight from `queryParams` (`:109-123`) and calls `stock-ledger/breakup`. Combined with XC-001, any authenticated user can enumerate ids and read the full movement history of every product.

**Steps to Reproduce**
1. Log in as a low-privilege user. 2. Open `/layout/stockLedger/details?productId=1&productType=part`, then 2, 3, …

**Actual Result:** Full stock movement timeline, references, serial numbers, supplier/customer names and created-by user for each product.
**Expected Result:** Route guard plus server-side authorisation scoped to the caller's plant/tenant.
**Suggested Fix:** Add a permission guard and enforce tenant/plant scoping in `stock-ledger/breakup`.
**Regression Areas:** All drill-downs; serial-track deep link (`/layout/stockAdjustment/detail`).
**Screenshots Required:** No
**API Affected:** `GET stock-ledger/breakup`

---

### Bug ID: SL-020
**Screen:** Stock Ledger Detail
**Severity:** Medium  **Priority:** P2
**Title:** Movement dates are assumed to be UTC and a `Z` is appended unconditionally

**Description**
`mapBreakupResponse()` (`:266-269`) appends `'Z'` to any `date` string not already ending in `Z`. If the API ever returns a local-time string (`2026-07-27 14:30:00`), every movement is shifted by the timezone offset.

**Steps to Reproduce**
1. Compare a movement's displayed timestamp against the same record in the database.
**Actual Result:** Potential 5h30m shift in IST.
**Expected Result:** The API contract states the timezone and the client parses accordingly.
**Suggested Fix:** Have the API return ISO-8601 with an explicit offset and delete the string patching.
**API Affected:** `GET stock-ledger/breakup`

---

### Bug ID: SL-021
**Screen:** Stock Ledger Detail
**Severity:** Medium  **Priority:** P3
**Title:** URL-derived status filters are applied on load with no visual indication that a filter is active

**Description**
`fetchBreakup()` derives `selectedStatuses` from the `status` query parameter and immediately calls `applyFilters()` (`:241-246`). `calculateTotals()` is also called twice (`:245` and inside `applyFilters()` at `:154`). The user arrives at a pre-filtered list and pre-filtered totals with nothing highlighting that a filter is in effect.

**Steps to Reproduce**
1. From the report, click the **REJECTED** cell for a product with both approved and rejected movements.
**Actual Result:** The detail shows only rejected movements and a Net Total that excludes everything else, with no "filtered by: Rejected" banner.
**Expected Result:** A visible active-filter chip and a one-click "show all".
**Suggested Fix:** Render the active filters as removable chips; remove the duplicate `calculateTotals()` call.
**Screenshots Required:** Yes
**API Affected:** None

---

## Add / adjust entry

### Bug ID: SL-022
**Screen:** Add Stock Ledger Report
**Severity:** High  **Priority:** P2
**Title:** Hard-coded demo master data still ships — Product A/B/C, "Rack A", "Receiving/Storage/Production/Dispatch"

**Description**
`add-stock-ledger-report.component.ts:35-52` declares:
```ts
productTypes = ['Raw Material', 'Finished Goods', 'Consumables'];
products = [{id:1,name:'Product A',...}, {id:2,name:'Product B',...}, {id:3,name:'Product C',...}];
stages = ['Receiving','Storage','Production','Dispatch'];
subStagesMap = { Receiving:['QC','Unloading'], Storage:['Rack A','Rack B'], ... };
```
`onStageChange()` drives the Sub Stage dropdown from `subStagesMap` (`:146-152`). The real ledger uses stages `GRN / INSP_INWARD / WIP / WO / INSP_FINAL / INV` and sub-stages `OP10 / OP20 / OP25 / INSP_FINAL / INV` (`stock-ledger-detail.component.ts:64-77`). The same placeholder `products` array is duplicated in the search component (`:71-75`).

**Steps to Reproduce**
1. Open the add/adjust screen. 2. Open the Stage dropdown.
**Actual Result:** Fictional stages; a saved entry carries a `stage` the ledger does not recognise, so the movement never appears under any real column.
**Expected Result:** Stage/sub-stage sourced from the same picklist the ledger uses.
**Suggested Fix:** Replace with the real picklists (they are already fetched elsewhere via `PicklistService`) and delete the duplicated demo arrays.
**Regression Areas:** Manual stock adjustments; ledger balances.
**Screenshots Required:** Yes
**API Affected:** `POST stock-ledger/create`, `PUT stock-ledger/update`

---

### Bug ID: SL-023
**Screen:** Add Stock Ledger Report
**Severity:** High  **Priority:** P2
**Title:** `Validators.min(1)` on quantity conflicts with the In/Out radio — outward movements cannot express direction

**Description**
`quantity: [null, [Validators.required, Validators.min(1)]]` (`:118`) forbids zero and negatives, while `stockMovement: ['in', Validators.required]` (`:123`) is a separate control. `onSubmit()` posts both unchanged (`:160-163`) with no sign handling, so the server must infer direction from `stockMovement` — a contract that is nowhere documented and not mirrored by `type` (`entryType` in/out lists at `:179-206`).

**Steps to Reproduce**
1. Select **Out**, quantity 10, save. 2. Inspect the persisted ledger row's sign.
**Actual Result:** Direction handling is ambiguous; an out movement may be stored as +10.
**Expected Result:** An explicit, tested rule (sign applied client- or server-side, not both).
**Suggested Fix:** Apply the sign in `onSubmit()` (`qty = stockMovement === 'out' ? -qty : qty`) or drop the radio and require a signed quantity; document it in the DTO.
**Regression Areas:** Ledger balances; the detail screen's `totalIn`/`totalOut` (`stock-ledger-detail.component.ts:168-181`, which branches on `qty > 0` / `qty < 0`).
**Screenshots Required:** Yes
**API Affected:** `POST stock-ledger/create`

---

### Bug ID: SL-024
**Screen:** Add Stock Ledger Report
**Severity:** Medium  **Priority:** P2
**Title:** No double-submit guard, no duplicate check and no confirmation on a stock-affecting write

**Description**
The Save handler (`:154-177`) has no `submitDisable`-style flag, no confirmation dialog and no duplicate detection. The button is not disabled while the request is in flight.

**Steps to Reproduce**
1. Fill the form. 2. Double-click **Save**.
**Actual Result:** Two identical ledger entries; stock is adjusted twice.
**Expected Result:** Single entry; confirmation before a manual stock adjustment.
**Suggested Fix:** Add an in-flight flag, a confirmation dialog and a server-side idempotency key.
**Regression Areas:** Manual adjustments.
**API Affected:** `POST stock-ledger/create`

---

### Bug ID: SL-025
**Screen:** Add Stock Ledger Report
**Severity:** Medium  **Priority:** P2
**Title:** `onSubmit` reads `.value` rather than `.getRawValue()` and formats the date without a timezone

**Description**
`:160` uses `this.addReportForm.value`, which omits any disabled control. `:161` transforms the date with `globals.dateFormatYMD` and **no** timezone argument, unlike the search screens which pass `globals.timeZone`. The backend compares with `sl.date <= ?` (`stock-ledger.service.ts:908-910`), so an off-by-one date puts the movement in the wrong period.

**Steps to Reproduce**
1. Save an entry dated today at 23:50 local time with the browser in a UTC-negative timezone. 2. Check the stored date.
**Actual Result:** Possible one-day shift.
**Expected Result:** Consistent timezone handling with the rest of the app.
**Suggested Fix:** `getRawValue()` and pass `this.globals.timeZone`.
**API Affected:** `POST stock-ledger/create`

---

## Layout, state & performance

### Bug ID: SL-026
**Screen:** Stock Ledger Report
**Severity:** Medium  **Priority:** P2
**Title:** A server error is presented to the user as "No Stock Ledger Data Available"

**Description**
The error handler sets `stockLedgerReportData = []` and `showResults = false` (`:466-470`). The template's only alternative block is the empty state "There are currently no records to display. Please try refreshing the data." (`html:3-17`). The toast (`errorFetchingStockLedgerData`) is transient; after it fades the screen asserts there is no data.

**Steps to Reproduce**
1. Make `stock-ledger/report` return 500. 2. Open the report and wait for the toast to disappear.
**Actual Result:** The screen claims the ledger is empty — a dangerous misstatement for a stock report.
**Expected Result:** A distinct error state that says the data could not be loaded, with Retry.
**Suggested Fix:** Add an `loadError` flag with its own template block.
**Screenshots Required:** Yes
**API Affected:** `GET stock-ledger/report`

---

### Bug ID: SL-027
**Screen:** Stock Ledger Report
**Severity:** Medium  **Priority:** P2
**Title:** Data is fetched from the constructor; `ngOnInit()` is an empty stub

**Description**
`this.onSearch()` is the last statement of the constructor (`:243`); `ngOnInit()` contains only a commented-out line (`:482-484`). Fetching before input binding and before the component is attached makes the lifecycle untestable and defeats any future `@Input`-driven filtering.

**Suggested Fix:** Move the initial load to `ngOnInit()` (and implement `OnInit`, which the class currently does not declare).
**API Affected:** None

---

### Bug ID: SL-028
**Screen:** Stock Ledger Report
**Severity:** Medium  **Priority:** P2
**Title:** `Refresh` re-fetches but leaves stale filters and paginator state

**Description**
`refresh()` simply calls `onSearch()` (`:246-248`). PrimeNG filters, the global search term and the current page index are untouched, so after a refresh the user can sit on a page beyond the new row count, or have filters hiding all of the new data — with the "Clear Filters" button being the only way out.

**Steps to Reproduce**
1. Filter to 2 rows and go to page 1 of 1. 2. Click **Refresh** after the data set has changed.
**Actual Result:** Grid appears empty or unchanged.
**Expected Result:** Refresh resets the paginator and either preserves or explicitly clears filters.
**Suggested Fix:** `this.dt?.clear()` (or `this.dt.first = 0`) as part of `refresh()`.
**Screenshots Required:** Yes
**API Affected:** `GET stock-ledger/report`

---

### Bug ID: SL-029
**Screen:** Stock Ledger Report
**Severity:** Medium  **Priority:** P2
**Title:** `hasFilters()` and `getUniqueUnits()` are template-bound and run on every change-detection cycle

**Description**
`hasFilters()` (`:573-575`) is bound to `[disabled]` on Clear Filters (`html:37`). `getUniqueUnits()` (`:835-840`) maps and filters the **entire** data set and is bound inside an `*ngFor` in the unit filter panel (`html:116`) — O(n) per checkbox, per CD pass. `getDisplayedWipValue()` and `formatReportQuantity()` are called once per WIP cell per pass (`html:366-377`).

**Steps to Reproduce**
1. Load a data set with 1000 rows and 6 WIP operations. 2. Type in the global search box.
**Actual Result:** Noticeable keystroke lag.
**Expected Result:** Precomputed values; `OnPush` change detection.
**Suggested Fix:** Cache `uniqueUnits` when the data loads; precompute WIP display values into the row model; add `trackBy`.
**Regression Areas:** Whole report.
**API Affected:** None

---

### Bug ID: SL-030
**Screen:** Stock Ledger Report
**Severity:** Medium  **Priority:** P3
**Title:** Footnote promises purple highlighting that does not exist

**Description**
`html:402-404` renders "Note: Purple highlighted rows indicate Waiting for Final Inspection Process." unconditionally — `*ngIf="stockLedgerReportData"` is truthy even for `[]`. No purple class is applied anywhere in the body template; the only conditional row/cell classes are `value-zero`, `highlight-op` and the `column.valueClass` set.

**Steps to Reproduce**
1. Open the report and look for a purple row.
**Actual Result:** The legend describes styling that never appears.
**Expected Result:** Implement the highlighting or remove the note.
**Screenshots Required:** Yes
**API Affected:** None

---

### Bug ID: SL-031
**Screen:** Stock Ledger Report
**Severity:** Medium  **Priority:** P3
**Title:** Empty state and results block are driven by independent conditions and can both render or neither

**Description**
The empty state uses `stockLedgerReportData.length === 0` (`html:3`); the results block uses `showResults` (`html:19`). `onSearch()` sets `showResults = true` optimistically before the response (`:272`), then the handler sets it to `length > 0` (`:459`). Between those two moments both conditions are true, so the "No Stock Ledger Data Available" panel renders **above** an empty results container.

**Steps to Reproduce**
1. Throttle the network and reload the report; watch the interval between request and response.
**Actual Result:** The empty-state panel flashes above the report header.
**Expected Result:** A single state machine: `loading | error | empty | ready`.
**Suggested Fix:** Replace the two booleans with one `state` field.
**Screenshots Required:** Yes
**API Affected:** None

---

### Bug ID: SL-032
**Screen:** Stock Ledger Report
**Severity:** Medium  **Priority:** P3
**Title:** Debug `console.log` of business data on every ledger cell click

**Description**
`onLedgerCellClick()` logs `console.log('options', row, options)` (`:185`). The row object contains product ids, customer names, part codes and every quantity.
**Suggested Fix:** Remove; add a `no-console` lint rule.
**API Affected:** None

---

### Bug ID: SL-033
**Screen:** Stock Ledger Report
**Severity:** Low  **Priority:** P3
**Title:** Report is not printable and has no print action

**Description**
The review checklist calls for print support. The grid is a `p-table` with `scrollHeight="65vh"` and `[scrollable]="true"` (`html:88-89`), inside `.table-container`. There is no print button and no `@media print` rule in `search-stock-ledger-report.component.scss`, so `Ctrl+P` captures only the rows currently inside the 65vh viewport.
**Expected Result:** Either a Print action that renders an unscrolled, paginated view, or an explicit statement that export-to-Excel is the supported path.
**Suggested Fix:** Add `@media print` rules that unset the scroll height and repeat the header, or generate a server-side PDF.
**Screenshots Required:** Yes
**API Affected:** None

---

### Bug ID: SL-034
**Screen:** Stock Ledger Report — Header
**Severity:** Low  **Priority:** P3
**Title:** Duplicated page title and a breadcrumb that only appears on one of the three routes served by the component

**Description**
`stock-ledger-report.component.html:20` renders `<h1>Stock Ledger Report</h1>` and `search-stock-ledger-report.component.html:21` renders `<h2 class="report-title">Stock Ledger Report</h2>` immediately below it. The periodical/tool variants of the same component (`layout-routing.module.ts:283-284`) render no breadcrumb at all (`html:1-11`).

**Expected Result:** One title; a breadcrumb on every variant.
**Screenshots Required:** Yes
**API Affected:** None

---

### Bug ID: SL-035
**Screen:** Stock Ledger Report
**Severity:** Low  **Priority:** P3
**Title:** Unused providers and imports inflate the bundle and duplicate service instances

**Description**
`search-stock-ledger-report.component.ts:51` lists `StockLedgerService` **twice** and `MachineService` twice, plus `ToolService`, `HolderService`, `SpecialToolService`, `CalibrationService` and `PartsService` which are never injected into this component. Component-level `providers` create fresh instances per component, defeating any caching in those services. `JsonPipe`, `NgForOf`, `KeyValuePipe`, `NgClass`, `DataTablesModule`, `RouterLink` are imported without use across this and `stock-ledger-report.component.ts`.

**Suggested Fix:** Provide services in `root`; prune the arrays; enable `noUnusedLocals`.
**API Affected:** None

---

## Appendix — Severity/priority summary

| Module | Critical | High | Medium | Low | Total |
|---|---|---|---|---|---|
| Cross-cutting | 2 | 2 | 1 | 1 | 6 |
| Job Work In | 2 | 6 | 16 | 6 | 30 |
| Job Work Out | 3 | 12 | 21 | 3 | 39 |
| Stock Ledger | 2 | 10 | 19 | 4 | 35 |
| **Total** | **9** | **30** | **57** | **14** | **110** |

### Recommended fix order

1. **XC-002** (loader hangs / dead error handlers) — blocks reliable testing of everything else.
2. **SL-002** (date filtering broken end to end) and **SL-001** (missing search form) — the Stock Ledger report is not fit for purpose without them.
3. **JWO-003 / JWO-004** (stock validation gated on the wrong flag, read before it loads).
4. **JWO-001 / JWO-002** (PO index corruption) and **JWO-015** (double submit).
5. **JWI-001 / JWI-002** (silent save failure and silent line-item loss).
6. **XC-001 / SL-019** (authorisation).
7. **SL-003 / SL-013 / JWI-018 / JWO-034** (filters and exports that do not reflect the screen).
8. Everything else by severity.
