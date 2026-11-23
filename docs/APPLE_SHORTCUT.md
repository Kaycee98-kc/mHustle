# Apple Reminders — the "mHustle Sync" Shortcut

> **Only want alerts on your iPhone?** The subscribed **Calendar** link (⚙ Settings → Add to Calendar) is fully automatic and already gives 7-day, 2-day, 1-day and 2-hour alerts. This Shortcut is only needed if you also want items in the Reminders app.

## Why a Shortcut?

Web apps (including home-screen PWAs) have **no access to Apple Reminders**. EventKit, Apple's Reminders API, is only available to native apps, and a native app would need the paid Apple Developer Program ($99/yr) plus App Store or TestFlight distribution.

The supported free route is **Apple Shortcuts**, which can find, add and remove reminders. mHustle keeps an outbox of reminder changes. This Shortcut pulls those changes and applies them to exactly three lists: **Clients**, **Follow Up** and **Hustle Task**.

### How the alerts are handled

- **Four alerts become four reminders.** A reminder created by Shortcuts can have only one alert time, so each appointment, lesson or Hustle Task gets four reminders: 7 days, 2 days, 1 day and 2 hours before. Their titles end with "(in 7 days)", "(in 2 days)", "(tomorrow)" and "(in 2 hours)". Alert times that are already past are skipped.
- **Edits replace reminders.** When you edit a record, mHustle sends "remove + add" for the affected reminders, so you never get duplicates. Every reminder's Notes field ends with a hidden key such as `[mh:client:…:7d]`, which the Shortcut uses to find it later.
- **Completion syncs both ways.** When you tick a follow-up in mHustle, its reminder is removed from **Follow Up**. When you complete a follow-up reminder in the Reminders app, the next sync ticks it in mHustle.
- **Repeated nagging uses push notifications.** Reminders cannot repeat "until done", so the repeating urgent and initial-email alerts are sent as mHustle push notifications. The Reminders entry fires once.

## One-time setup

1. In the **Reminders** app, create three lists named exactly **Clients**, **Follow Up** and **Hustle Task** (singular). Do not create a Potential Clients list.
2. In mHustle, open **⚙ Settings → Create calendar & sync link**. Copy the **Shortcut address** (`https://m-hustle.vercel.app/api/reminders-sync`) and the **token**. The token is shown only once. The same token also powers the Calendar subscription.

## Build the Shortcut (iPhone: Shortcuts app → +)

Name it **mHustle Sync**. Add these actions in order. Words in *italics* are the values you pick or type.

**Part A: pull changes**

1. **Text**: paste the token. Rename the output to *Token*.
2. **Text**: paste the address `https://m-hustle.vercel.app/api/reminders-sync`. Rename it to *SyncURL*.
3. **Get Contents of URL**: URL *SyncURL*. Method *GET*. Headers: `x-mhustle-token` = *Token*.
4. **Get Dictionary Value**: *ops* from *Contents of URL*.
5. **Repeat with Each** item in *Dictionary Value*:
   1. **Get Dictionary Value**: *key* from *Repeat Item*. Then **Set Variable** *Key*.
   2. **Find Reminders**: *All Reminders* where **Notes contains** *Key*.
   3. **If** *Reminders* **has any value**: **Remove Reminders** → *Reminders*. Open "Show More" and turn **off** "Confirm Before Deleting". **End If**.
   4. **Get Dictionary Value**: *op* from *Repeat Item*.
   5. **If** *Dictionary Value* **is** `add`:
      - **Get Dictionary Value**: *alert_text* from *Repeat Item*. Then **Get Dates from Input** → *Dates*.
      - **Get Dictionary Value**: *title* from *Repeat Item* → **Set Variable** *Title*.
      - **Get Dictionary Value**: *notes* from *Repeat Item* → **Set Variable** *Notes*.
      - **Get Dictionary Value**: *list* from *Repeat Item*.
      - **If** *Dictionary Value* **is** `Clients` → **Add New Reminder** *Title* in **Clients**. Turn **Remind Me** on, *At a Time* = *Dates*. Notes = *Notes*.
      - **Otherwise If** it **is** `Follow Up` → the same **Add New Reminder**, in **Follow Up**.
      - **Otherwise** → the same **Add New Reminder**, in **Hustle Task**.
      - **End If**
   6. **End If**
6. **End Repeat**
7. **Get Dictionary Value**: *ack* from *Contents of URL* (step 3).
8. **Get Contents of URL**: URL *SyncURL*. Method *POST*. Headers `x-mhustle-token` = *Token*. Request Body *JSON*: `action` = `ack`, `ack` = *Dictionary Value*.

**Part B: send completions back**

9. **Find Reminders**: list **is Follow Up**, **Is Completed is true**, **Notes contains** `mh:fu:`.
10. **Get Details of Reminders**: *Notes* of *Reminders*.
11. **Combine Text**: *Notes*, with *New Lines*.
12. **Get Contents of URL**: URL *SyncURL*. Method *POST*. Same header. JSON body: `action` = `completed`, `text` = *Combined Text*.

> Tip: the GET response includes `"more": true` when more than 40 changes are waiting. Just run the Shortcut again, or add **If** *more* is true → **Run Shortcut** *mHustle Sync* at the end.

## Make it automatic

Shortcuts app → **Automation → + → Time of Day**. Choose, for example, **7:30 AM**, **12:30 PM** and **6:30 PM** daily, then select **Run Immediately** and pick *mHustle Sync*. You can also run it any time from a Home Screen icon or the Share Sheet.

## Test it

1. Add an Appointment in mHustle for about 10 days ahead.
2. Run **mHustle Sync**. Four reminders should appear in **Clients**.
3. Change the time in mHustle and run the Shortcut again. The four reminders are replaced with no duplicates.
4. Add a Potential client and run the Shortcut. "Send initial email to …" appears in **Follow Up**.
5. Complete that reminder in the Reminders app and run the Shortcut. In mHustle, the client is now **Emailed**, and a next-Monday follow-up has been created.
