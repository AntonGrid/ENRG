# Chapter 5. The First Law of Trust

> *"Every security system eventually comes down to one question: whom does it trust?"*

When designing a distributed system, almost everyone first discusses cryptography.

Which algorithms to use.

What key size to choose.

How to protect the communication channel.

How to encrypt data.

But very quickly it becomes clear that no algorithm can independently create trust.

Cryptography only provides tools.

Architecture determines how these tools will be used.

This is where one of the most important questions arises.

**Where should the source of trust be located?**

At first glance, the answer seems obvious.

On the server.

After all, the server is always available.

It is the one that stores the database.

It is the one that makes decisions.

It is the one that interacts with the blockchain.

This is how most modern systems are built.

But this approach contains a fundamental problem.

If the server becomes the source of trust, then the entire system depends on the server.

Any compromise of the server automatically compromises the entire network.

A strange situation arises.

Externally, the system may look distributed.

It may use blockchain.

It may have thousands of devices.

It may have dozens of nodes.

But in fact, trust is still concentrated in one place.

Which means that true decentralization does not exist.

This observation led to the first architectural law of Axis.

> **The private key never leaves the device.**

At first glance, this looks like an ordinary security rule.

In fact, its meaning is much deeper.

The private key is the cryptographic identity of the device.

If this identity can be copied, transferred, or restored on the server, the device ceases to be an independent participant in the network.

It becomes just a remote sensor.

A true network participant must have its own identity.

It independently participates in creating trust.

It independently signs the results of its work.

It independently takes responsibility for the origin of its own data.

The server no longer becomes the owner of trust.

It becomes only a verifier.

This change seems small.

But it is precisely this that completely changes the architecture.

The Oracle no longer creates proofs.

It verifies existing ones.

The Registry no longer stores secrets.

It stores only public information.

The Policy Engine no longer trusts the server.

It trusts the cryptographically confirmed identity of the device.

Gradually, it becomes clear that this approach resembles relationships between people.

No one can live another person's life.

No one can take another person's responsibility.

No one can sign for another person without violating the very meaning of the signature.

The cryptographic signature of a device has the same nature.

It confirms not only the correctness of the data.

It confirms the origin of that data.

That is why the private key must never leave the device.

Even if it seems inconvenient.

Even if development becomes more difficult.

Even if the server could perform the same actions faster.

Convenience must never destroy trust.

This rule gradually begins to extend far beyond cryptography.

Each component of the system begins to take responsibility only for its own area of responsibility.

Each participant performs only the work that they can independently confirm.

Thus, another fundamental principle is gradually born.

**Trust cannot be transferred.**

It can only be proven.

It is this principle that will later become the foundation of Proof-of-Production.

The foundation of Device Identity.

The foundation of the entire model of interaction between the physical and digital worlds.

Over time, programming languages will change.

Devices will change.

New cryptographic algorithms will appear.

But as long as the device independently stores its identity and independently confirms the origin of its actions, the architecture will continue to comply with the first law of trust.

That is why this law turned out to be much more important than any specific technology.

It does not define implementation.

It defines the philosophy of the entire system.
