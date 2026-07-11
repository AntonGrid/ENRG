# ENRG Architecture

Status: Active

---

# Overview

ENRG is a protocol, not a single application.

The protocol defines the rules for decentralized energy production, verification, accounting, and tokenization.

Every software component within the ENRG ecosystem is an implementation of the protocol.

---

# Architecture Layers

```
                    ENRG Protocol
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
 Protocol Rules      Specifications      Registries
        │                 │                 │
        └─────────────────┼─────────────────┘
                          │
                    Architecture
                          │
             ADR • RFC • Principles
                          │
                    Implementation
        ┌──────────┬──────────┬──────────┬──────────┐
        │          │          │          │
 Smart Contract  Oracle     SDK     Device Firmware
        │          │          │          │
        └──────────┼──────────┼──────────┘
                   │
              Client Applications
                   │
     Dashboard • Mobile • CLI • Explorer
```

---

# Documentation Hierarchy

The documentation is organized into several layers.

## Protocol

Defines protocol behavior.

Location:

```
docs/protocol/
```

---

## Architecture

Defines architectural decisions.

Location:

```
docs/architecture/
```

Includes:

- ADR
- Roadmaps
- Development Workflow
- Implementation Principles

---

## Specifications

Defines terminology and conformance.

Location:

```
docs/specifications/
```

Includes:

- Terminology
- Conformance

---

## Registries

Defines protocol registries.

Location:

```
docs/registry/
```

Includes:

- Events
- Errors
- Capabilities
- Manifests

---

# Development Process

Every protocol change follows the workflow:

```
Idea
    ↓
Architecture
    ↓
Protocol Specification
    ↓
Roadmap
    ↓
Implementation
    ↓
Testing
    ↓
Conformance
    ↓
Release
```

Implementation never becomes the source of truth.

The protocol remains the source of truth.

---

# Implementations

Current implementations include:

- Smart Contract
- Oracle
- Dashboard
- SDK
- Device Firmware

Future implementations may include:

- Mobile Application
- Explorer
- Analytics
- Third-party integrations

All implementations MUST remain compatible with the protocol.

---

# Protocol Evolution

The protocol evolves through:

- Specifications
- ADRs
- RFCs
- Registries

Implementations evolve through source code.

These processes are intentionally separated.

---

# Core Principles

1. Protocol First.
2. Documentation Before Code.
3. Implementation Must Follow Specification.
4. Compatibility Before Convenience.
5. Architecture Before Optimization.
6. Security Before Performance.
7. Simplicity Before Complexity.

---

# Vision

ENRG is designed as an open protocol for decentralized energy.

The protocol is intended to outlive any individual implementation.

Smart contracts, oracles, SDKs, dashboards, and future software components are replaceable.

The protocol remains stable.

The ecosystem evolves around it.
