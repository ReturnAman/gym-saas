# 01 — PRODUCT REQUIREMENTS

**Project:** `gym-saas`  
**Product Brand:** TBD  
**Parent Company:** TBD  
**Document Version:** 0.1  
**Status:** Product definition  
**Scope:** V1 + planned future direction

---

# 1. Purpose

This document defines the functional requirements and product behavior for the gym SaaS platform.

It translates the Project Charter into concrete product requirements.

This document describes:

- Who uses the system
- What users can do
- Core business rules
- V1 scope
- Future scope
- Important product constraints
- Acceptance expectations

This document does not define the detailed database schema, API implementation, infrastructure, or UI design.

Those will be defined in later documents.

---

# 2. Product Users

The system has two primary user groups.

## 2.1 Gym-side users

### OWNER

The primary customer and highest-level organization role.

The owner can:

- Configure the gym
- Manage members
- Manage memberships
- Manage payments
- Manage attendance
- Manage staff
- Manage roles/permissions
- Configure gym payment information
- View operational information
- Manage announcements
- Manage product settings
- View reports/exports
- Manage gym subscription/trial state where applicable

---

### ADMIN

An organization-level operational role.

The exact permissions will be defined in the authorization design.

An admin may perform many owner-like operational tasks but does not automatically have every owner capability.

---

### STAFF

A gym operational user.

Staff capabilities will depend on assigned permissions.

Typical responsibilities may include:

- Member operations
- Attendance operations
- Payment verification
- Membership operations

Staff must not receive unrestricted owner access by default.

---

### TRAINER

A gym operational user whose permissions are intentionally narrower.

Trainer capabilities will be defined through the permission model.

Trainer must not automatically receive access to financial or administrative operations.

---

## 2.2 MEMBER

The member is the primary end user of the member-facing experience.

Members can:

- Authenticate
- Access their gym
- Check in
- View attendance
- View membership
- View payment status
- Submit payment claims
- View announcements
- View occupancy
- Use future engagement features

---

# 3. Multi-Tenant Requirements

The system must support multiple independent gyms.

Each gym is an independent organization/tenant.

### Requirement

A user must only access data belonging to organizations in which the user has appropriate membership and authorization.

### Example

If a user belongs to:

```text
Gym A
Gym B
