---
name: Paper alert outbox
description: Durable delivery rule for TEST TRADING Telegram notifications.
---

Persist a paper-trading event with a unique account/trade/event-type identity before attempting Telegram delivery. Mark it sent only after the sender succeeds; failed sends remain pending with a retry time.

**Why:** Telegram is an external service and can be temporarily unavailable, while monitor cycles must not create duplicate notifications or lose an event.

**How to apply:** Keep event payloads sufficient to render the notification later, serialize delivery through one in-process queue, and treat the database status as the source of truth for `/paper alerts`.