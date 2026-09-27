# ADR 006 — File Storage

**Project:** gym-saas  
**Status:** Proposed  
**Date:** YYYY-MM-DD  
**Decision Type:** Data / Storage / Privacy

---

# 1. Context

The initial gym-saas product does not require significant file storage.

The main future file-related feature is:

> Member progress photos

Progress photos are potentially sensitive personal data and therefore require stronger privacy considerations than ordinary application assets.

The product direction is:

> Local-first progress photos where practical.

This means the application should avoid automatically uploading personal progress photos to the cloud unless the user explicitly chooses a feature that requires cloud storage.

---

# 2. V1 Requirement

File storage is not required for the initial V1 owner/member core.

V1 can operate without a dedicated object-storage service.

Do not introduce cloud file storage merely because the infrastructure stack supports it.

---

# 3. Future Progress Photos

A future member experience may allow:

- Taking a progress photo
- Selecting a photo from the device
- Viewing personal progress photos
- Comparing previous photos
- Organizing photos by date

The initial design preference is:

```text
Member Device
      ↓
Local Storage
      ↓
Progress Photos
rather than:

Member Device
      ↓
Cloud Upload
      ↓
SaaS Storage
4. Privacy Principle

Progress photos should be treated as private user content.

They should not automatically become:

Public gym content
Public profile content
Leaderboard content
Searchable content
Admin-visible content

unless the product explicitly introduces such functionality and the user intentionally enables it.

5. Local-First Architecture

Where browser capabilities allow, progress photos should initially remain on the user's device.

Potential technologies may include:

IndexedDB
Browser storage APIs
PWA-compatible local storage mechanisms

The exact implementation should be decided when the feature is actually developed.

The application should not assume that every browser/device provides unlimited local storage.

6. Local Storage Limitations

Local-first storage has limitations.

Potential problems include:

Device replacement
Browser data clearing
Storage limits
Private browsing behavior
Device loss
Browser differences
Lack of automatic backup
Difficulty accessing photos across multiple devices

These trade-offs must be clearly communicated if the feature is implemented.

7. Optional Cloud Backup

A future version may allow members to explicitly enable:

Cloud backup

The flow could be:

Progress Photo
      ↓
User Chooses Cloud Backup
      ↓
Secure Upload
      ↓
Private Object Storage
      ↓
Authenticated Access

Cloud storage should not be enabled merely because the user created a progress photo.

8. Object Storage

If cloud storage is introduced, object storage should be used rather than storing large binary files directly inside PostgreSQL.

Conceptually:

PostgreSQL
   ↓
Photo Metadata
   ↓
Object Storage
   ↓
Actual Image

PostgreSQL may store metadata such as:

User ID
Organization ID
Object key
Creation date
File type
File size
Optional description

The exact schema will be defined during feature implementation.

9. Tenant Isolation

If cloud photos are introduced, every stored object must have a clear ownership model.

Conceptually:

Organization
    ↓
Member
    ↓
Progress Photo
    ↓
Object

Access must be authorized server-side.

A user must not gain access to another member's photo by modifying an object ID or URL.

10. Private Access

Progress photos should not use publicly accessible permanent URLs.

Preferred future access pattern:

Authenticated Request
       ↓
Authorization Check
       ↓
Generate Short-Lived Access
       ↓
Private Object

Signed URLs or equivalent private-access mechanisms may be used when appropriate.

11. File Upload Security

If cloud uploads are introduced, the application must validate:

File type
File size
Upload authorization
Ownership
Storage destination
Filename/object-key safety

Do not trust the filename or MIME type supplied by the client as the only security check.

12. Image Processing

Future image processing may include:

Resize
Compression
Thumbnail generation
Metadata stripping

The exact processing requirements should be defined when cloud photo storage is implemented.

The system should avoid unnecessary processing during V1.

13. EXIF and Metadata

Images may contain metadata such as:

GPS location
Device information
Timestamp
Camera information

If photos are uploaded to cloud storage, the product should consider whether metadata should be stripped before storage or sharing.

This is particularly important if photos may ever be exported or shared.

14. Access Control

Potential future access model:

Member

Can access:

Own photos
OWNER / ADMIN

Should not automatically receive access to private member progress photos.

Any future staff/admin access must be an explicit product decision with a clear privacy justification.

Other Members

No access.

15. Sharing

Public sharing should not be part of the initial progress-photo design.

If sharing is introduced later, it should be an explicit user action.

Potential future sharing controls could include:

Private
Share with selected people
Share with gym
Public

These options should not be enabled implicitly.

16. Deletion

Users should eventually be able to delete their own uploaded progress photos where the product supports cloud storage.

Deletion should consider:

Database metadata
Object storage
Thumbnails
Derived versions
Backups
Retention policies

The exact deletion semantics should be defined before implementing cloud storage.

17. Retention

The application should avoid storing personal photos indefinitely without a product reason.

If cloud backup is introduced, retention rules should be documented.

Local-only photos remain subject to the device/browser's own storage behavior.

18. Backup

If cloud photos become a supported product feature, backup requirements must be defined separately from normal application database backups.

Backing up PostgreSQL does not automatically back up object storage.

19. Storage Costs

File storage can become a meaningful infrastructure cost because photos can be large.

Potential cost drivers include:

Number of members
Photos per member
Average image size
Original-resolution storage
Thumbnails
Backup copies
Data transfer
Retention period

The product should avoid unlimited storage by default.

20. Storage Limits

If cloud backup is introduced, reasonable limits should be defined.

Possible limits include:

Maximum file size
Maximum number of photos
Storage quota per member
Storage quota per organization
Supported image formats

Exact limits should be decided based on real usage.

21. V1 Infrastructure

No dedicated object-storage service is required for V1.

The initial architecture can operate with:

Next.js
   ↓
PostgreSQL

without a file-storage provider.

22. Provider Selection

The future storage provider remains open.

Potential providers may include:

Azure Blob Storage
Amazon S3-compatible storage
Cloudflare R2
Other managed object-storage providers

The final provider should be selected based on:

Cost
Privacy/security
Access-control capabilities
Integration
Reliability
Backup options
Data location
Egress costs
Student benefits where applicable

Current pricing should be verified before making a production selection.

23. Provider Abstraction

The application should not spread provider-specific storage APIs throughout business logic.

Conceptually:

Application
     ↓
File Storage Service
     ↓
Object Storage Provider

However, a large generic storage abstraction should not be created before a real storage requirement exists.

24. Testing

If cloud file storage is introduced, tests should cover:

Upload authorization
Tenant isolation
Member ownership
File-size validation
File-type validation
Unauthorized download
Signed URL/access expiration
Deletion
Failed uploads
Duplicate uploads
Storage errors

Automated tests should use test storage or a mock provider where appropriate.

25. Security Requirements

File storage must not:

expose private photos publicly
trust client-provided ownership
allow cross-tenant access
store secrets in object metadata
expose permanent private URLs unnecessarily
allow unrestricted uploads
rely only on frontend validation
26. Decision
Current Status

No cloud file-storage provider is required for V1.

The preferred future direction is:

Local-first progress photos
Optional explicit cloud backup
Private object storage
Server-side authorization
Short-lived access where appropriate
Clear storage limits
Explicit deletion and retention rules
27. Consequences
Positive
Lower V1 infrastructure cost
Less complexity
Better privacy by default
No unnecessary storage dependency
Smaller initial attack surface
Easier initial deployment
Trade-offs
Local photos may be lost when device/browser storage is cleared
Cross-device access is limited
Cloud backup requires additional infrastructure later
Large photo collections require storage-cost management
28. Future Reassessment

Reassess this decision when:

Progress photos become a committed product feature
Members request cross-device access
Cloud backup becomes necessary
Gym workflows require photo access
Storage requirements become measurable
Privacy requirements change
29. Related Documents
01-PRODUCT-REQUIREMENTS.md
03-SYSTEM-ARCHITECTURE.md
04-DATABASE-DESIGN.md
06-SECURITY.md
08-PWA.md
10-DEVOPS.md
12-SCALABILITY.md
13-COST-INFRASTRUCTURE.md
14-TECH-DECISIONS.md
20-CURRENT-STATE.md
30. Approval

Decision Owner: Project Owner

Status: Proposed

V1 Cloud Storage: No

Future Cloud Backup: Possible

Preferred Initial Approach: Local-first

Object Storage Provider: TBD

Approval Date: N/A
