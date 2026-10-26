---
name: __PLUGIN_NAME__-engineering-review
description: Review a selected change and its production verification evidence.
disable-model-invocation: true
user-invocable: true
---

Review only the change requested by the user. Read the applicable project instructions,
identify behavioral risks, and verify relevant tests and the current compiled artifact.
Report concrete findings with source references before summarizing. Do not install
software, change the default agent, or modify unrelated user data during a review.
