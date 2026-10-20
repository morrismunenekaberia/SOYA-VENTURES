# 🛒 Soya Ventures Multi-Platform Application

A comprehensive, multi-platform supply chain and agency management system built for **Soya Ventures**. Designed for seamless cross-platform performance across **Windows desktop, iOS, and Android**, this application handles inventory distribution, multi-tier agent recruitment, sales tracking, and operational analytics.

---

## 👥 User Roles & Permissions

The platform supports four distinct user roles, ensuring secure and segregated access:

1. **Admin:** 
   - Absolute, full-system control and permission management.
   - Access to global financial metrics, system configurations, and broadcast push notifications.
2. **Manager:** 
   - Oversight, analytics, and performance monitoring.
   - Tracks top-performing Center Pickups and agents, processes hub-level restocking requests, and triggers targeted push notifications.
3. **Center Pickups (Hubs):** 
   - Local physical or virtual inventory hubs where agents pick up products.
   - Manages local stock and requests inventory replenishment strictly from the **Manager**.
4. **Agents:** 
   - Direct sales force with self-service registration.
   - Picks up goods from assigned Center Pickups, tracks personal sales, and earns direct commissions.
   - **Referral System:** Can recruit downline agents (1-level deep) to earn override commissions on their sales.

---

## ⚙️ Core Business Logic

* **Hierarchical Ordering:** 
  *  $ightarrow$ Requests stock from $ightarrow$ 
  *  $ightarrow$ Requests stock from $ightarrow$ 
* **Commission Engine:** Automated calculation for direct product sales plus a 1-level deep referral bonus override.
* **Notification System:** Segmented push notifications dispatched by Admin/Manager roles to hubs or agents.

---

## 🛠️ Tech Stack & Architecture

* **Frontend:** Flutter (Cross-platform support for Windows, iOS, and Android)
* **Backend:** [Python / FastAPI or Node.js / NestJS]
* **Database:** PostgreSQL (Structured relational tracking for users, orders, inventory, and commissions)
* **State Management:** [e.g., Riverpod / Provider / Bloc]

---

## 🔍 Engineering & Debugging

To ensure high maintainability, the system features a centralized **Console Logging & Interceptor Service**:
* Real-time network request/response tracing.
* Action and state change tracking for order flows and commission payouts.
* Instant error-capture middleware in the backend console to isolate and resolve bugs rapidly.

---

## 🚀 Getting Started

Instructions on how to set up the development environment, run migrations, and launch the Flutter application locally will be added soon.
