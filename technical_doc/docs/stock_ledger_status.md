# Stock Ledger Status List

---

## 🟩 Completed Modules & Features

# GRN Entry Screens
- Purchase Inward – API integrated  
- Supplier Job Work Inward – API integrated  
- Customer Job Work Inward – API integrated  
- Returnable DC Inward – API pending  
- Miscellaneous Inward – Screen and API pending

# Notifications Screen
- Displays non-inspected items  
- Integration pending for Miscellaneous Inward  
- Provides direct navigation to Inspection Status with pre-filled data  
- Route: Notification → Inward Inspection

# Purchase Inward
- Inspection Status added (header & line-item)

# Customer Job Work Inward
- Inspection Status added (header & line-item)  
- Editing restricted after inspection completion

# Customer Job Work Outward
- Only inspected Customer Job Work Inward entries allowed

# Customer Job Work Reports
- Customer Job Work Tracking Report

# Returnable DC Inward
- Inspection Status added (header & line-item)  
- Same inspection logic as Customer Job Work Inward

# Batch Creation
- Available before Operation 30  
- Only inspected GRNs and FG included  
- Production/Quality can access Production Inward + Inspection

# Inspection Screen
- Sampling & quantity inspection  
- Control Plan-based inspection  
- Purchase Inward closes after inspection  
- Supplier Job Work In inspected through Outsource screen

# Control Task
- Batch integration completed  
- Logic differs for normal vs production/quality users

# Stock Ledger
- Control Task, Bulk Entry, Hourly Entry  
- Outsource (logic based on user type)  
- Special Process, Rework, NCR, Final Inspection  
- Invoice (Beta)

# Stock Report
- Base Stock Report completed

---

## 🟨 In Progress Modules & Features

# Miscellaneous Inward
- Screen in progress  
- API pending

# GRN Entry Screens
- Miscellaneous Inward – Screen + API pending

# Consumption
- In progress  
- Quantity reduction logic in Stock Ledger

# Production Stock Ledger
- In progress

# Packing
- In progress

# Cards in Open Project
- 4739 – Opening Balance Stock  
- 4702 – Control Task Active/Inactive  
- 4700 – Gate Entry → Purchase Inward  
- 4710 – Gate Entry → Customer Job Work In

---

## 🟧 Pending Modules & Features

# GRN Entry
- Returnable DC Inward – API pending  
- Miscellaneous Inward – Screen + API pending

# Job Order Creation
- Stock Ledger API integration pending

# Miscellaneous Inward
- Integrate with Consumption & Non-Returnable screens

# Debit Note
- Only inspected inwards can be used

### Stock Ledger – Pending Logic
- Assembly  
- Operation Value Add  
- Override logic  
- Override Value Add logic  
- Serial Number handling

# Stock Reports – Pending
- In-House Stock Report  
- In-House Breakup Report  
- Store Consumption Report

# Miscellaneous Inward Integration
- To be added in Notification screen after completion

# Cards in Open Project
- 4709 – Adjustment Screen  
- 4740 – Monthly Cron Job  
- 4691 – Stock Ledger Drilldown  
- 4741 – No DC/Invoice without Stock  
- Department-wise Notification filter  
- Flag for omitting parts in Quantity Inspection  

# Customer Job Work – Pending Clarifications
- Stock reduction point (Outward vs Invoice)  
- Handle RM Part & Expected Part  
- Update Stock Ledger API  
- Rejection qty & not-processed qty handling  
- Scrap Entry Screen for rejected qty

---

## 🟦 Under Discussion - Modules & Features


# Invoice
- Need confirmation on consumption logic

# Existing Stock Logic & Reports
- Decision pending

# Credit Note
- Business rule review required

# Purchase Inward
- Opening balance already updated in Invproductdetails  
- Can remove old logic if unused
