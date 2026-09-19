# Booking Search package radio installation

Status: local candidate; independent review and GitHub delivery required before installation. Not installed or live-Wix verified.

Replace only the Booking Search page code with the complete raw `velo/page-booking-search.js` from the eventual reviewed GitHub commit. Do not paste line-numbered tool output.

## Editor prerequisite

Inside `packageRepeater`'s item template, inside `packageContainer`, add a Wix **Radio Button Group** with exact ID `radioPackage`. Configure **exactly one option** in Manage Choices; keep your preferred option label and a nonempty value. Leave the group visible, expanded, enabled, not required, and not connected to a dataset. Remove `vectorImage1`. Do not add an Editor onChange handler: page code registers it once. This is RadioButtonGroup, not a checkbox or an individual invented radio API.

Code preserves the Editor option list, labels and values. It selects option index 0 for the selected package and clears other groups with `selectedIndex = undefined`. Missing radio elements are tolerated so existing row/text clicks continue working, but then there is no visible selection indicator. Multiple options are unsupported setup, not silently rewritten.

The first valid quoted visible package is selected, retaining non-Scuba-before-Scuba order. Radio changes and existing row/text clicks use the same guarded selection path and update amenities, price and signed Summary handoff. Matching uses package IDs, not titles. Retained repeater rows refresh without duplicate registrations.

After reviewed delivery, verify in Wix Preview: exactly the first row selected; select another radio and confirm only it is selected and amenities/price change; repeat a search and verify the new first row. No reservation submission is needed. Preview is not SSR verification. No backend/CMS/Secrets/dependencies, tracking, styling or other page replacements are part of this change.

Rollback requires both the prior Booking Search page code and restoring its `vectorImage1` item-template indicator; restoring only the old code after deleting the vector will not restore its visual indicator.

Official API references:
- https://dev.wix.com/docs/velo/api-reference/$w/radio-button-group/selected-index (0 selects first option; undefined clears)
- https://dev.wix.com/docs/velo/api-reference/$w/radio-button-group/on-change (user change event; programmatic value changes do not dispatch it)
