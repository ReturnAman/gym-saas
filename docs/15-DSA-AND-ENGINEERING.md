# DSA & Engineering

## Project

- Project: gym-saas
- Document: DSA and Software Engineering Roadmap
- Version: 0.1
- Status: Learning & Engineering Definition
- Scope: V1 and long-term engineering growth

---

# 1. Purpose

This document defines how software-engineering fundamentals and Data Structures & Algorithms (DSA) learning will be connected to the gym-saas project.

The objective is to become a stronger software engineer while building a real product.

The project should not become only a tutorial project.

Likewise, DSA preparation should not be neglected merely because the product is being built.

The two tracks should reinforce each other.

---

# 2. Learning Principles

The learning strategy follows these principles:

1. Understand concepts rather than memorize solutions.
2. Build real software while learning fundamentals.
3. Use gym-saas as an engineering laboratory.
4. Connect theoretical concepts to real implementation problems.
5. Practice DSA separately from product development.
6. Understand time and space complexity.
7. Learn why an engineering decision was made.
8. Prefer simple correct implementations before optimization.
9. Study failures and trade-offs.
10. Turn meaningful project decisions into interview explanations.

---

# 3. Two Parallel Tracks

The learning plan has two major tracks.

## Track A — Product Engineering

Build gym-saas.

Topics include:

- TypeScript
- React
- Next.js
- PostgreSQL
- APIs
- authentication
- authorization
- security
- testing
- Git
- CI/CD
- deployment
- observability
- scalability
- system design

## Track B — DSA and CS Fundamentals

Study separately.

Topics include:

- arrays
- strings
- hashing
- linked lists
- stacks
- queues
- trees
- heaps
- graphs
- recursion
- backtracking
- sorting
- searching
- dynamic programming
- greedy algorithms
- complexity
- operating systems
- networking
- databases
- computer architecture
- system design

Neither track should completely replace the other.

---

# 4. Why DSA Matters

DSA is useful for:

- problem solving
- algorithmic thinking
- technical interviews
- understanding performance
- recognizing trade-offs
- writing efficient code

DSA should not be treated as a requirement to over-engineer ordinary product features.

For example:

```text
Small gym member list
    ↓
Simple PostgreSQL query
is preferable to inventing a custom search engine merely to demonstrate an algorithm.

5. DSA Learning Order

The initial order should be:

1. Complexity
2. Arrays
3. Strings
4. Hashing
5. Two pointers
6. Sliding window
7. Stack
8. Queue
9. Linked list
10. Binary search
11. Sorting
12. Recursion
13. Trees
14. Binary search tree
15. Heap / priority queue
16. Graphs
17. Greedy algorithms
18. Backtracking
19. Dynamic programming
20. Advanced topics

The order may evolve based on progress.

6. Complexity Analysis

Complexity analysis is foundational.

Learn:

O(1)
O(log n)
O(n)
O(n log n)
O(n²)
O(2ⁿ)
O(n!)

Understand:

time complexity
space complexity
best case
average case
worst case
amortized behavior

Every important DSA solution should eventually be explainable in terms of time and space complexity.

7. Arrays

Learn:

traversal
insertion/deletion
searching
prefix sums
frequency counting
sorting
in-place operations
subarrays

Patterns:

two pointers
sliding window
prefix sum
frequency map

Project connection:

paginated member lists
attendance records
dashboard aggregation
processing exported data
8. Strings

Learn:

character frequency
substring operations
palindrome problems
string comparison
parsing
normalization

Project connection:

search
validation
phone normalization
user input processing
9. Hashing

Learn:

hash maps
hash sets
frequency counting
lookup optimization
duplicate detection

Project connection:

efficient membership lookup
deduplication
grouping
notification processing
authorization-related lookup structures

Important distinction:

An in-memory hash map is not a replacement for database persistence.

10. Two Pointers

Learn when two-pointer techniques apply.

Typical problems:

sorted arrays
pair sums
duplicate handling
partitioning
string comparisons

Project connection:

Use this mainly as an algorithmic learning pattern.

Do not force two-pointer algorithms into product code where a database query is more appropriate.

11. Sliding Window

Learn:

fixed-size windows
variable-size windows
frequency tracking
maximum/minimum window problems

Project connection:

Potentially useful for:

attendance analysis
activity windows
rolling metrics
recent activity

Actual production implementation should be based on the database/query requirements.

12. Stack

Learn:

LIFO behavior
balanced parentheses
monotonic stack
expression evaluation
recursion simulation

Project connection:

request processing concepts
browser navigation concepts
undo/redo concepts

The primary goal is understanding the data structure and its applications.

13. Queue

Learn:

FIFO behavior
circular queues
priority queues
producer/consumer concepts

Project connection:

Notification processing may eventually resemble:

Notification Jobs
      ↓
Queue
      ↓
Worker
      ↓
Provider

This creates a useful connection between DSA and real backend architecture.

14. Linked Lists

Learn:

singly linked lists
doubly linked lists
insertion
deletion
reversal
cycle detection
fast/slow pointers

Project connection:

Primarily an algorithmic and interview topic.

Do not assume linked lists should replace database structures in the SaaS.

15. Binary Search

Learn:

classic binary search
boundary handling
search on answer
rotated arrays
lower/upper bounds

Important skill:

Recognize when the search space is monotonic.

Project connection:

Useful for understanding efficient search, but PostgreSQL indexing should normally handle application data lookup.

16. Sorting

Learn:

bubble sort
selection sort
insertion sort
merge sort
quicksort
heap sort
counting sort where appropriate

Understand:

comparison-based sorting
stability
in-place behavior
complexity
practical library sorting

Do not reimplement sorting in production unless there is a genuine reason.

17. Recursion

Learn:

base cases
recursive state
call stack
divide and conquer
tree traversal
backtracking

Important question:

What state does each recursive call represent?

18. Trees

Learn:

binary trees
DFS
BFS
preorder
inorder
postorder
level-order traversal
height
depth
balanced trees

Project connection:

Useful for understanding:

hierarchical data
indexes
query structures
organizational relationships
19. Binary Search Trees

Learn:

insertion
deletion
search
traversal
balanced vs unbalanced trees

Understand why an unbalanced tree can degrade toward:

O(n)

instead of:

O(log n)
20. Heap and Priority Queue

Learn:

min heap
max heap
insertion
extraction
heapify
priority queues

Project connection:

Potential applications include:

prioritizing jobs
processing notifications
scheduling tasks

Again, actual production implementation depends on the selected infrastructure.

21. Graphs

Learn:

graph representation
adjacency list
adjacency matrix
BFS
DFS
connected components
shortest paths
topological sorting
cycle detection

Project connection:

Future relationships such as:

Users
  ↕
Organizations
  ↕
Memberships

can help develop graph intuition.

However, the relational database remains the source of truth.

22. Greedy Algorithms

Learn:

local-choice reasoning
interval problems
scheduling
optimization patterns

Important skill:

Understand when greedy is valid and when it is not.

Do not assume a locally optimal choice always produces a globally optimal solution.

23. Backtracking

Learn:

decision trees
state restoration
pruning
permutations
combinations
subsets
constraint problems

Backtracking is primarily an algorithmic learning area for this project.

24. Dynamic Programming

Learn progressively:

Recursion
    ↓
Memoization
    ↓
Tabulation
    ↓
State optimization

Core concepts:

overlapping subproblems
optimal substructure
state definition
transitions
base cases

Important skill:

Before writing DP code, clearly define:

What does dp[state] mean?

25. Advanced DSA

Only after fundamentals are strong, explore:

tries
union-find
segment trees
Fenwick trees
advanced graph algorithms
shortest path algorithms
minimum spanning trees
advanced dynamic programming
string algorithms

These should not distract from core engineering or interview fundamentals too early.

26. Problem-Solving Workflow

For every DSA problem:

Understand problem
      ↓
Clarify constraints
      ↓
Create examples
      ↓
Brute-force idea
      ↓
Identify bottleneck
      ↓
Find pattern
      ↓
Optimize
      ↓
Prove/check correctness
      ↓
Analyze complexity
      ↓
Implement
      ↓
Test edge cases

Do not immediately search for the solution.

27. DSA Mistake Log

Maintain a record of problems that were:

misunderstood
solved incorrectly
solved inefficiently
forgotten
solved with an unfamiliar pattern

For each mistake record:

Problem
Pattern
Mistake
Correct reasoning
Complexity
What to remember

The purpose is to improve reasoning rather than accumulate solved-problem counts.

28. Spaced Revision

Previously solved problems should be revisited.

Suggested pattern:

Day 1
Day 3
Day 7
Day 14
Day 30

The exact schedule can change.

Revision should focus on:

recognizing the pattern
explaining the approach
reproducing the solution
understanding complexity
29. SQL Fundamentals

SQL is part of engineering preparation.

Learn:

SELECT
WHERE
ORDER BY
GROUP BY
HAVING
JOIN
subqueries
CTEs
aggregates
indexes
transactions
constraints
normalization
query plans

Project connection:

The gym SaaS database is a real environment for practicing these concepts.

30. Database Engineering

Understand:

primary keys
foreign keys
unique constraints
indexes
transactions
isolation
locking
consistency
migrations
normalization
denormalization
query performance

Especially understand why the project uses PostgreSQL.

31. Transactions

Understand why transactions matter.

Examples:

Payment confirmation may require multiple related state changes.

Attendance operations may require consistency between related records.

A transaction can provide:

All required changes succeed
        OR
None of them are committed

The exact transaction boundaries should be defined during implementation.

32. Concurrency

Learn:

race conditions
lost updates
duplicate operations
optimistic concurrency
pessimistic locking
database constraints

Project examples:

two staff members confirm one payment
two check-in requests arrive simultaneously
two updates modify the same membership

These are valuable real-world engineering problems.

33. HTTP and Networking

Learn:

HTTP request/response
methods
status codes
headers
cookies
sessions
TLS/HTTPS
DNS
TCP basics
latency
caching
proxies

Project connection:

Every frontend/backend interaction provides a practical networking example.

34. API Engineering

Learn:

request validation
response design
authentication
authorization
pagination
filtering
sorting
error handling
idempotency
rate limiting

Understand why an API should not trust the frontend.

35. Authentication Engineering

Understand:

identity
sessions
tokens
OTP
expiration
rate limiting
replay
account recovery

Project example:

Phone
  ↓
OTP
  ↓
Authenticated user
  ↓
Organization authorization

Authentication and authorization must remain conceptually separate.

36. Security Fundamentals

Study:

authentication
authorization
least privilege
input validation
output encoding
injection
XSS
CSRF
SSRF
rate limiting
secrets
session security
tenant isolation
secure logging

Use the actual project security model as a practical learning reference.

37. Git and GitHub

Become comfortable with:

commits
branches
merge
rebase
pull requests
conflicts
revert
tags
GitHub Actions
code review

Important skill:

Understand what changed rather than treating Git as a backup button.

38. Testing Fundamentals

Learn:

unit tests
integration tests
API tests
end-to-end tests
mocks
fixtures
test isolation
regression testing
test determinism

Project connection:

Use the payment, authorization, tenant-isolation, and attendance domains as high-value testing exercises.

39. TypeScript

Become strong in:

types
interfaces
unions
generics
narrowing
utility types
async/await
error handling
modules
type-safe API boundaries

Do not use TypeScript merely as JavaScript with annotations.

Understand how the type system prevents classes of bugs.

40. React and Next.js

Learn:

React
components
props
state
effects
forms
composition
rendering
client/server considerations
Next.js
routing
server/client boundaries
server-side behavior
API/backend integration
rendering
deployment

The exact implementation should follow 03-SYSTEM-ARCHITECTURE.md and 08-PWA.md.

41. Backend Engineering

Learn:

request lifecycle
validation
business logic
persistence
transactions
authorization
error handling
logging
background processing
idempotency

Avoid putting all business logic directly inside route handlers.

42. Clean Code

Practice:

meaningful names
small functions
clear control flow
explicit behavior
appropriate abstraction
low coupling
high cohesion

Avoid:

giant functions
deep nesting
clever one-liners
unnecessary abstractions
duplicated business rules
magic constants
hidden side effects
43. SOLID Principles

Learn SOLID as a tool rather than a checklist.

Understand:

Single Responsibility
Open/Closed
Liskov Substitution
Interface Segregation
Dependency Inversion

Do not force SOLID abstractions into simple code.

The goal is maintainability, not maximum abstraction.

44. Design Patterns

Learn patterns when a real problem demonstrates their value.

Potential patterns relevant to the project:

Repository
Strategy
Adapter
Factory
Dependency Injection
Observer/event-based concepts

Example:

Notification providers can use an adapter/provider boundary.

Do not create design-pattern-heavy code merely to demonstrate patterns.

45. System Design Fundamentals

Study:

scalability
availability
consistency
caching
queues
load balancing
databases
replication
partitioning
rate limiting
observability
failure handling

Use gym-saas as the practical system-design case study.

46. System Design Progression

Learn in this order:

Single application
      ↓
Database
      ↓
Caching
      ↓
Background jobs
      ↓
Horizontal scaling
      ↓
Replication
      ↓
Queues
      ↓
Distributed systems

Do not start with distributed systems before understanding the single-application version.

47. Practical System Design Exercises

Use the project for exercises such as:

Design member search

Consider:

database indexes
pagination
filtering
query performance
Design attendance check-in

Consider:

authentication
authorization
transactions
duplicate requests
concurrency
Design notification delivery

Consider:

queue
retries
idempotency
provider failures
delivery status
Design live occupancy

Consider:

active sessions
consistency
caching
query performance
48. Operating Systems

Study:

processes
threads
memory
virtual memory
scheduling
synchronization
deadlocks
filesystems
system calls

These concepts improve understanding of backend systems and runtime behavior.

49. Computer Architecture

Study fundamentals:

CPU
memory
cache
storage
instruction execution
I/O

The goal is practical engineering understanding, not hardware specialization.

50. Networking Fundamentals

Study:

DNS
TCP
UDP
HTTP
HTTPS
TLS
proxies
load balancers
latency
bandwidth

Connect these concepts to actual application requests.

51. Distributed Systems Fundamentals

After core backend knowledge, study:

replication
consistency
leader/follower concepts
retries
idempotency
eventual consistency
distributed locks
queues
failure detection

Important principle:

Distributed systems are difficult because failures and coordination become unavoidable.

Do not introduce distributed architecture merely to demonstrate knowledge.

52. Engineering Trade-Offs

For every important technical choice, ask:

What problem does this solve?
What does it cost?
What complexity does it add?
What alternatives exist?
What happens at larger scale?
What happens when it fails?

This is more valuable than memorizing technology names.

53. Learning Through Real Bugs

Real bugs should become learning opportunities.

For each important bug:

Symptom
   ↓
Reproduction
   ↓
Root cause
   ↓
Fix
   ↓
Regression test
   ↓
Engineering lesson

Document important lessons when they affect architecture or recurring engineering practice.

54. Engineering Journal

Maintain lightweight engineering notes for meaningful lessons.

Potential topics:

why an index was added
why a transaction was required
why a provider abstraction exists
why a security rule exists
why a query was optimized
why a design was rejected

These notes can later become interview material.

55. Interview Connection

Every meaningful project decision should eventually be explainable in an interview.

For example:

Question

Why PostgreSQL?

Answer should cover:

relational domain
transactions
constraints
joins
consistency
tenant model
Question

Why modular monolith?

Answer should cover:

early-stage product
lower operational complexity
clear internal boundaries
ability to scale later
Question

How do you prevent cross-gym data access?

Answer should cover:

organization membership
backend authorization
tenant-scoped queries
resource ownership
tests
56. DSA vs Project Time

Do not allow either track to consume all available learning time.

A balanced schedule may look like:

Product Engineering
        +
DSA
        +
CS Fundamentals
        +
Interview Revision

The exact hours depend on personal schedule and job-search priorities.

Consistency matters more than extreme daily volume.

57. Suggested Weekly Structure

A possible structure:

Mon–Fri
Product development + DSA

Some sessions
CS fundamentals

Weekend
Revision
Project review
DSA revision
Interview practice

This is a flexible framework rather than a mandatory schedule.

58. DSA Practice Quality

Prioritize:

Understand
>
Solve
>
Explain
>
Optimize
>
Remember

Do not optimize for:

Number of problems solved

A problem fully understood is more valuable than many problems solved through pattern memorization.

59. DSA Problem Difficulty

Progress approximately through:

Easy
  ↓
Easy/Medium
  ↓
Medium
  ↓
Medium+
  ↓
Hard when fundamentals are strong

Do not rush into difficult problems before basic patterns are reliable.

60. Programming Language for DSA

Use one primary language consistently for DSA.

Since the project uses TypeScript, TypeScript can be used for DSA practice.

However, interview requirements may differ by target company.

If another language becomes necessary later, the underlying algorithmic reasoning should transfer.

61. SQL Interview Preparation

Practice queries involving:

joins
grouping
aggregation
subqueries
CTEs
window functions
ranking
date calculations
duplicate detection

Use the gym SaaS domain for realistic examples.

Example entities:

organizations
members
memberships
payments
attendance
62. Backend Interview Preparation

Be prepared to explain:

request lifecycle
authentication
authorization
tenant isolation
database transactions
API design
validation
rate limiting
background jobs
retries
idempotency
logging
deployment
63. System Design Interview Preparation

Eventually practice designing:

gym management SaaS
notification system
attendance system
payment tracking system
URL shortener
chat system
file storage system
rate limiter

The gym SaaS should be the primary project case study.

64. Behavioral Interview Preparation

Use actual project experiences.

Prepare stories around:

difficult bug
security decision
architectural trade-off
disagreement
failed approach
performance problem
learning a new technology
working with AI tools
handling ambiguity
shipping under constraints

Stories should be truthful and based on actual work.

65. AI and Engineering Learning

AI should accelerate learning, not replace understanding.

Good use:

Attempt
  ↓
Ask AI for hint
  ↓
Solve
  ↓
Ask AI to review
  ↓
Understand mistakes

Less useful:

Question
  ↓
Copy solution
  ↓
Move on

The second approach produces weaker long-term understanding.

66. AI Code Review Practice

When AI generates code:

Read it.
Explain it.
Identify assumptions.
Check security.
Check data flow.
Check error handling.
Check edge cases.
Run tests.
Modify it if necessary.

Never treat AI-generated code as inherently correct.

67. Engineering Skill Levels

A useful progression:

Level 1 — Beginner

Can:

write basic TypeScript
use Git
understand simple APIs
write simple SQL
solve basic DSA
Level 2 — Developing Engineer

Can:

build features
write tests
debug issues
use PostgreSQL
implement authorization
understand complexity
review AI-generated code
Level 3 — Job-Ready Engineer

Can:

design backend features
reason about security
debug production-like issues
explain trade-offs
design APIs
handle concurrency
solve medium DSA problems
Level 4 — Strong Engineer

Can:

reason about architecture
optimize systems
design scalable components
understand distributed-system trade-offs
mentor others
make sound technical decisions

The levels are directional, not formal certifications.

68. Practical Engineering Milestones
Milestone 1

Understand:

Git
TypeScript
HTTP
SQL
basic DSA
Milestone 2

Build:

authentication
CRUD
database relationships
tests
Milestone 3

Build:

authorization
tenant isolation
payments
attendance
notifications
Milestone 4

Understand:

transactions
concurrency
caching
queues
observability
Milestone 5

Understand:

scaling
distributed systems
system design
production operations
69. What Not to Optimize Too Early

Avoid spending excessive learning time on:

advanced distributed systems before backend fundamentals
obscure algorithms before common patterns
Kubernetes before basic deployment
advanced cloud architecture before using a simple cloud deployment
complex design patterns before writing maintainable code

Learn in the order of practical importance.

70. Engineering Portfolio Value

The gym SaaS can demonstrate:

real product development
multi-tenancy
authentication
authorization
PostgreSQL
payments
attendance
PWA
testing
CI/CD
observability
security
scalability
AI-assisted development

The portfolio value comes from understanding and being able to explain the implementation, not from the number of technologies listed.

71. Resume Evidence

Eventually collect evidence such as:

shipped features
architecture decisions
production users
paying customers
performance improvements
reliability improvements
security improvements
test coverage in critical areas
infrastructure cost
meaningful technical problems solved

Do not fabricate metrics.

Use measured numbers when available.

72. DSA Progress Tracking

Track:

Topic
Problems attempted
Problems solved independently
Patterns understood
Mistakes
Revision status

Do not use the number of solved problems as the only measure of progress.

73. Engineering Progress Tracking

Track:

Feature
Technical concepts learned
Implementation completed
Tests added
Bug discovered
Engineering lesson
Interview explanation

This creates a connection between building and learning.

74. Recommended Learning Loop

The overall loop is:

Learn concept
      ↓
Build something
      ↓
Encounter problem
      ↓
Investigate
      ↓
Understand
      ↓
Implement
      ↓
Test
      ↓
Document
      ↓
Explain
      ↓
Revise

This should become the default engineering-learning cycle.

75. Current Priority

At the current project stage, prioritize:

Product Engineering
Architecture understanding
PostgreSQL
TypeScript
API/backend fundamentals
Authentication
Authorization
Security
Testing
Git/GitHub
Deployment
DSA
Complexity
Arrays
Strings
Hashing
Two pointers
Sliding window
Stack/queue
Linked lists
Binary search
Trees

Do not attempt every advanced topic immediately.

76. Relationship With Other Documents

This document connects with:

03-SYSTEM-ARCHITECTURE.md
04-DATABASE-DESIGN.md
05-AUTHORIZATION.md
06-SECURITY.md
07-API-SPECIFICATION.md
09-TESTING.md
10-DEVOPS.md
11-OBSERVABILITY.md
12-SCALABILITY.md
14-TECH-DECISIONS.md

It also supports:

16-INTERVIEW-MASTER.md
77. Status

Status: DSA and engineering learning strategy defined.

This document defines the learning direction.

The learning plan should evolve as:

project complexity increases
interview requirements become clearer
engineering weaknesses are discovered
real production problems appear
DSA performance improves

The objective is not merely to finish a syllabus.

The objective is to become capable of designing, implementing, testing, debugging, explaining, and improving real software.
