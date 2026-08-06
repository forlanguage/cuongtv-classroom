# Deferred evidence acceptance criteria

- iPhone Safari does not decode QR images client-side.
- PIN is validated before camera evidence steps are unlocked.
- QR image preview appears immediately after capture/selection.
- Face image preview appears immediately after capture.
- The final submit uploads both images in one idempotent request.
- The resulting record is `recorded` and `needs_review`, never automatically `present`.
- Teacher review can approve or reject the record.
- A failed upload keeps both local previews and allows retry without recapturing.
