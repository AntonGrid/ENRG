# Chapter 4. Architecture Is Born Before the Code

> *"Code answers the question 'how?'. Architecture answers the question 'why?'."*

Every software system exists in two worlds at once.

The first world is seen by most developers.

This is the world of source code.

Functions.

Algorithms.

Databases.

APIs.

Commands.

Requests.

This is where the main daily work happens.

Bugs are fixed.

New features are added.

Performance is optimized.

It seems that this is where the system is created.

But there is a second world.

It is much less visible.

It is in this world that architecture is born.

Architecture does not begin with programming.

It begins with questions.

Why should a device store its own cryptographic identity?

Why should an Oracle not make decisions instead of the protocol?

Why should device state exist in only one place?

Why are rules more important than a specific implementation?

Each such question gradually turns into a principle.

And each principle becomes the foundation of future architecture.

That is why Architecture Decision Records began to appear in Axis.

At first they looked like ordinary notes.

Later it became clear that they were something much more.

Each ADR recorded not a technical decision.

It recorded an engineering principle.

Not a description of implementation.

But an explanation of the reason.

This is what distinguishes architecture from programming.

Programming answers the question:

> "How do we implement the solution?"

Architecture answers:

> **"Why should such a solution exist?"**

At first glance, this difference seems insignificant.

In practice, it is precisely this that determines the system's ability to evolve.

You can rewrite code endlessly.

Change programming languages.

Replace databases.

Migrate the system between different platforms.

But if the architectural principles remain unchanged, the system continues to be itself.

That is why many decisions in Axis took significantly longer than their subsequent implementation.

For example, the question of private key storage.

From a technical point of view, there were many options.

The server could issue keys itself.

Or store them centrally.

Or sign messages on behalf of devices.

Such solutions would greatly simplify development.

But at the same time they would destroy the fundamental rule of trust.

That is why a principle appeared:

**The private key never leaves the device.**

This was no longer a software decision.

It became a law of architecture.

Later, other principles appeared in a similar way.

The Device Registry became the single source of truth.

The Policy Engine separated from the Oracle.

The Device Manifest became a contract between the device and the protocol.

The Lifecycle ceased to be a simple state diagram.

It became a description of the full life of a device within the ecosystem.

Each new decision reduced the coupling of the system.

Each component received its own area of responsibility.

This is how true architecture gradually began to take shape.

Not as a set of modules.

But as a system of independent rules.

At some point, another observation became clear.

Good architecture rarely makes a strong impression.

It looks natural.

So natural that after a few years the feeling arises:

> "Could it have been done any other way?"

But that is precisely the sign of mature engineering thought.

The best architectural decisions cease to seem like decisions.

They begin to be perceived as obvious rules.

That is why architecture always evolves more slowly than code.

It requires much more caution.

A function can be changed in a few minutes.

An architectural principle sometimes cannot be changed without changing the entire system.

For this reason, every such decision must be made much more carefully.

It is architectural principles that determine the protocol's ability to outlive its own implementations.

Programming languages will inevitably change.

Modern libraries will disappear.

New computing platforms will emerge.

Equipment will change.

But if the fundamental principles remain correct, new generations of engineers will be able to recreate Axis from scratch over and over again.

And each time there will be a new implementation.

But always the same protocol.

That is when the true role of the architect becomes clear.

The architect does not design code.

They design the space within which future generations will be able to create their own solutions.
