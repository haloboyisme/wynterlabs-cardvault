# Custom Card Import

Available in **V2.5.9**.

Signed-in members open **Custom Card Import** from the main navigation. Supply a name and game (or Other / Custom collectibles), then optionally a set name, collector number, HTTPS image link and estimated USD value. Quantity defaults to one. The card enters the existing private collection as near mint/nonfoil; existing collection controls manage quantity, condition and manual valuation afterward.

Custom cards are explicitly labeled user supplied. They can be selected through Cards for a same-game deck. Their artwork comes from the owner's HTTPS image host directly, with no referrer; provider artwork continues using the authenticated cache. Image uploads are not included.

Export custom cards from this page as JSON to preserve their names, set details, image links, values, conditions and quantities. Importing creates new private copies, not updates; repeated import duplicates cards. Each import accepts up to 500 records; the browser file limit is 2 MiB. Standard collection CSV continues to work with existing printing IDs on the same installation/account, but does not recreate missing card definitions: use custom JSON for portability. Backups include the new records through the existing database backup process.

Ownership is enforced for card details, catalog searches, oracle printings, sets, collection additions, CSV previews/confirmation and deck additions. Custom cards are excluded from community activity and protected from provider refresh deactivation. Existing account deletion removes the user's custom records. Existing feeder functionality is preserved. Streamer effects and Bluetooth remain future roadmap work.

## Upgrade and recovery

Back up before upgrading. Migration `0021_custom_cards` adds ownership references
to catalog tables and enables custom-category decks. Upgrade using the normal
[standalone procedure](UPGRADING.md).

The migration deliberately refuses to remove ownership columns on downgrade,
because that could expose private records. Restore a pre-upgrade backup only
with a coordinated recovery plan that preserves any newer user data.

## Verification

Creation, validation, ownership isolation, collection/deck integration, JSON
portability, CSV ownership checks and account deletion have automated coverage.
A PostgreSQL 17.6 backup was restored in isolation and migrated successfully.
The private deployment's signed-in page and application health were verified.
No new application dependency was added. Image uploads are not included.
