# Manual Testing Guide: UID 15779

## Context
UID 15779 is a Tenpo Vista transaction email that was causing production to block with:
```
HTTP 400: Category does not belong to account Space
```

This document provides step-by-step instructions to verify the fix works correctly.

## Pre-Test Verification

### 1. Confirm Current State
```sql
-- Check cursor position (should be stuck at 15696)
SELECT folder, uidvalidity, last_uid, updated_at 
FROM bank_email_cursor;

-- Check existing logs for UID 15779 (should show errors)
SELECT uid, provider, decision, account_id, category_id, 
       import_success, error_message, created_at
FROM bank_email_processing_log 
WHERE uid = 15779
ORDER BY created_at DESC;
```

Expected current state:
- `last_uid`: 15696 (blocked)
- `bank_email_processing_log` entries for UID 15779: decision="error", category_id=null (logging gap), error_message contains "Category does not belong"

### 2. Deploy the Fix
Merge PR #11 and deploy to Railway. Wait for deployment to complete.

## Testing Steps

### Step 1: Trigger Worker Execution

**Option A: Wait for cron schedule** (if re-enabled)
- Worker will automatically process on next schedule

**Option B: Manual trigger** (if cron schedule is still null/paused)
```bash
# In Railway, trigger a one-off execution
railway run npm start
```

### Step 2: Monitor Logs in Real-Time

Watch Railway logs for UID 15779 processing. Expected sequence:

```
Bank email cron worker starting...
Self-check: verifying service configuration...
Current cursor: UID 15696, UIDVALIDITY 1
Fetched 83 new messages

[UID 15779] Step: before parse
[UID 15779] Step: after parse (skip=false, provider=tenpo)
[UID 15779] Step: before isTransaction
[UID 15779] Step: after isTransaction (result=true)
[UID 15779] Resolved account nxk4kf3fka5r8a3ozqtks in space ms2yt6sp7kwmn11qrupu3
[UID 15779] Step: before chooseCategory
[UID 15779] Step: after chooseCategory (categoryId=3pql9t6aiqfxbuhz0yrg5)
[UID 15779] Step: before import
[UID 15779] Step: after import (success=true)
UID 15779: imported successfully as mvt_...

-- OR if no category match --

[UID 15779] Step: after chooseCategory (categoryId=null)
[UID 15779] Step: before import
[UID 15779] Step: after import (success=true)
UID 15779: imported successfully as mvt_...
```

### Step 3: Verify Database State

```sql
-- Verify cursor advanced
SELECT folder, uidvalidity, last_uid, updated_at 
FROM bank_email_cursor;
-- Expected: last_uid >= 15779

-- Verify processing log
SELECT uid, provider, decision, account_id, category_id, 
       import_success, import_duplicate, error_message, created_at
FROM bank_email_processing_log 
WHERE uid = 15779
ORDER BY created_at DESC 
LIMIT 1;
```

**Expected results:**
- `decision`: "imported" (or "duplicate_success" if previously imported during debugging)
- `account_id`: "nxk4kf3fka5r8a3ozqtks" ← **NEW: now populated**
- `category_id`: Casa category ID (e.g., "3pql9t6aiqfxbuhz0yrg5") OR null ← **NEW: now populated, never Personal space ID**
- `import_success`: true
- `error_message`: NULL ← **FIXED: no longer "Category does not belong..."**

### Step 4: Verify in Wallit UI

Navigate to Tenpo Vista account movements and verify:
- New movement imported for the date of UID 15779 email
- Account: Tenpo Vista (Casa space)
- Category: 
  - If classified: a Casa category (e.g., "Transferencias" from Casa space)
  - If unclassified: no category (can be manually assigned later)
- **NOT**: a Personal space category (would be impossible now)

### Step 5: Verify Category Space Mapping

If a category was assigned, verify it belongs to Casa space:

```javascript
// From space-mappings.mjs
const CATEGORY_SPACES = {
  // Casa categories (should match if categoryId assigned)
  '3pql9t6aiqfxbuhz0yrg5': 'ms2yt6sp7kwmn11qrupu3', // Transferencias (Casa)
  '9m35h226dm0g1yjgq6u4h': 'ms2yt6sp7kwmn11qrupu3', // Supermercado (Casa)
  // ... other Casa categories
  
  // Personal categories (should NEVER appear for UID 15779)
  'gxy5t9fsotwokfeqfge6h': 'personal_a12e6f85fccd3cd8f7b385577c952ba0', // Transferencias (Personal) - the old problematic choice
  // ... other Personal categories
};
```

Cross-reference the `category_id` from the log with the mappings to confirm it's in `ms2yt6sp7kwmn11qrupu3` (Casa) space.

## Success Criteria

✅ **Primary**: UID 15779 processes without error  
✅ **Logging**: `account_id` and `category_id` now populated in database  
✅ **Category**: If assigned, belongs to Casa space (not Personal)  
✅ **Import**: Movement appears in Wallit under correct account  
✅ **Cursor**: Advances past 15779, unblocking future emails  
✅ **No 400 error**: Never see "Category does not belong to account Space"

## Failure Scenarios & Troubleshooting

### Scenario 1: Still getting 400 error
**Symptoms**: Error message still contains "Category does not belong to account Space"

**Check**:
1. Verify deployment completed successfully
2. Check logs show correct space: `ms2yt6sp7kwmn11qrupu3`
3. Check category_id in logs is NOT one of these Personal IDs:
   - `gxy5t9fsotwokfeqfge6h` (Transferencias Personal)
   - `l1exaaayy8ilffwd7mrfb` (Supermercado Personal)
   - Any ID from Personal space in space-mappings.mjs

**If still failing**: Check defensive validation triggered:
```
[UID 15779] Defensive guard: category X does not belong to account Y space, setting to null
```
If this appears but still get 400, there's a bug in `isCategoryInAccountSpace()`.

### Scenario 2: Category is null but user expects classification
**Symptoms**: `category_id` is null in database

**This is expected if**:
- LLM chose `__skip__` (merchant unclear)
- LLM confidence below threshold (default 0.70)
- Defensive guard kicked in (should see warning in logs)

**This is OK**: Import succeeds, user can manually categorize in UI.

### Scenario 3: Wrong prompt used
**Symptoms**: Logs show Personal prompt being used for Casa account

**Check**: 
1. Verify `accountId` passed to `chooseCategory()` 
2. Check `getAccountSpace(accountId)` returns correct space
3. Verify Casa prompt file exists: `prompts/best-category-choice-casa.json`

### Scenario 4: Cursor doesn't advance
**Symptoms**: `last_uid` stays at 15696

**Check**:
1. Did import succeed? Look for "imported successfully" in logs
2. Check `advance` flag in processEmail return value
3. Verify no other actionable error occurred before or on UID 15779

## Post-Test: Monitor Subsequent UIDs

After UID 15779 succeeds, monitor the next ~20 UIDs to ensure:
- Personal account emails still work (BCI, MercadoPago, Tenpo Credit)
- Casa account emails work (Tenpo Vista, BCI Casa)
- No regression in existing functionality
- `account_id` and `category_id` logged consistently

## Rollback Trigger

Rollback if:
- UID 15779 still fails with 400 error after fix deployed
- Tests fail after deployment
- Other accounts start failing that worked before
- Performance degrades significantly

Rollback steps in [SOLUTION_SUMMARY.md](../../SOLUTION_SUMMARY.md#rollback-plan).
