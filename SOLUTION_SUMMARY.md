# Fix: Cross-Space Category Selection in Bank Email Cron

## PR Details
- **URL**: https://github.com/rmena1/wallit/pull/11
- **Branch**: `cursor/fix-cross-space-category-selection-b4a5`
- **Status**: Draft PR ready for review
- **Tests**: All 102 tests passing ✓

## Problem Statement

The `bank-email-cron` worker was blocked at IMAP UID 15779 (Tenpo Vista email) with:
```
HTTP 400: Category does not belong to account Space
```

**Root Cause**: The classifier was selecting categories from the Personal space for an account in the Casa space. Specifically:
- Email: Tenpo Vista transfer (UID 15779)
- Resolved account: `nxk4kf3fka5r8a3ozqtks` (Tenpo Vista, Casa space `ms2yt6sp7kwmn11qrupu3`)
- Category chosen: `gxy5t9fsotwokfeqfge6h` (Transferencias, Personal space)
- Result: Import API correctly rejected with 400 error
- Impact: Cursor stayed at 15696, blocking all subsequent emails

## Solution Implemented

### 1. Space-Aware Category Selection
**New Files:**
- `workers/bank-email-cron/src/data/space-mappings.mjs`
  - Maps 11 accounts to their spaces (8 Personal, 3 Casa)
  - Maps 68 categories to their spaces (37 Personal, 31 Casa)
  - Exports `getAccountSpace()`, `getCategorySpace()`, `isCategoryInAccountSpace()`

- `workers/bank-email-cron/prompts/best-category-choice-casa.json`
  - Casa-specific category prompt with 31 Casa space categories
  - Mirrors Personal prompt structure but with Casa category IDs
  - Includes Casa-specific categories like "Arriendo/GC", "Limpieza", "Muebles", "Utensilios"

**Modified Logic:**
- `classifier.mjs` → `chooseCategory()` now accepts `accountId` parameter
- Determines account's space using `getAccountSpace(accountId)`
- Selects correct prompt: Casa accounts use Casa prompt, Personal accounts use Personal prompt
- After LLM selection, validates category space matches account space
- Returns `null` if spaces don't match (instead of invalid category)

### 2. Defensive Validation
**In `index.mjs`:**
```javascript
let validatedCategoryId = categoryId;
if (categoryId && !isCategoryInAccountSpace(categoryId, parsed.accountId)) {
  console.warn(
    `Defensive guard: category ${categoryId} does not belong to account ${parsed.accountId} space, setting to null`
  );
  validatedCategoryId = null;
}
```

This ensures that even if classifier somehow returns a cross-space category, it gets converted to `null` before import (which is allowed by the API).

### 3. Enhanced Logging
**Added fields to processing log:**
- `accountId` — logged for both success and error paths
- `categoryId` — logged after chooseCategory (was missing before)
- Space context in error logs for debugging

**Database changes:**
- Added `account_id` column to `bank_email_processing_log` table
- Migration runs automatically on worker startup

**Log output now includes:**
```
[UID 15779] Resolved account nxk4kf3fka5r8a3ozqtks in space ms2yt6sp7kwmn11qrupu3
[UID 15779] Step: after chooseCategory (categoryId=3pql9t6aiqfxbuhz0yrg5)
```

### 4. Comprehensive Testing
**New test file:** `test/space-aware-category.test.mjs`

Tests cover:
- ✓ Personal account receives Personal category
- ✓ Casa account receives Casa category  
- ✓ Cross-space mismatch returns null
- ✓ Null category allowed regardless of space
- ✓ Casa account uses Casa prompt with correct criteria
- ✓ Personal account uses Personal prompt with correct criteria
- ✓ Low confidence returns null
- ✓ Space mapping functions work correctly
- ✓ Import payload validation

**Test results:** 102/102 tests passing (including 18 new tests)

## Key Design Decisions

1. **Two separate prompts** (Personal vs Casa) instead of one mega-prompt
   - Simpler for LLM to choose from relevant set
   - Prevents LLM from seeing categories it shouldn't pick
   - Easier to maintain and update per-space

2. **Space mappings as static data** instead of runtime API calls
   - Worker already has account IDs in env vars
   - Categories are stable reference data
   - No network dependency for space resolution
   - Fast lookups without DB queries

3. **Null category on mismatch** instead of error
   - Import API allows `categoryId=null` 
   - Better to import uncategorized than fail completely
   - User can categorize manually in UI later
   - Preserves email processing flow

4. **Defensive validation** even after space-aware selection
   - Defense in depth: catches any future bugs in classifier
   - Prevents production blocks from similar issues
   - Logs warning but continues processing

## Files Changed

```
M  workers/bank-email-cron/src/index.mjs                     (+31 lines, logging & validation)
M  workers/bank-email-cron/src/lib/classifier.mjs            (+24 lines, space-aware selection)
M  workers/bank-email-cron/src/lib/database.mjs              (+17 lines, account_id column)
A  workers/bank-email-cron/src/data/space-mappings.mjs       (+103 lines, space data)
A  workers/bank-email-cron/prompts/best-category-choice-casa.json (+45 lines, Casa prompt)
A  workers/bank-email-cron/test/space-aware-category.test.mjs    (+293 lines, tests)
```

## Manual Verification After Deploy

### Pre-deployment Check
1. Confirm tests pass: `cd workers/bank-email-cron && npm test`
2. Verify environment variables are set (Railway):
   - `ACCOUNT_TENPO_VISTA_ID=nxk4kf3fka5r8a3ozqtks` (should already exist)
   - All other account IDs present in space-mappings.mjs

### Post-deployment Verification

**Step 1: Check cursor status**
```sql
SELECT folder, uidvalidity, last_uid, updated_at 
FROM bank_email_cursor;
```
Expected: `last_uid` should still be 15696 (blocked state)

**Step 2: Trigger worker execution**
- Railway will run on next cron schedule (or trigger manually)
- Watch Railway logs for UID 15779 processing

**Step 3: Verify logs show correct behavior**
Expected log sequence:
```
[UID 15779] Step: before parse
[UID 15779] Step: after parse (skip=false, provider=tenpo)
[UID 15779] Step: before isTransaction
[UID 15779] Step: after isTransaction (result=true)
[UID 15779] Resolved account nxk4kf3fka5r8a3ozqtks in space ms2yt6sp7kwmn11qrupu3
[UID 15779] Step: before chooseCategory
[UID 15779] Step: after chooseCategory (categoryId=3pql9t6aiqfxbuhz0yrg5 OR null)
[UID 15779] Step: before import
[UID 15779] Step: after import (success=true)
UID 15779: imported successfully as [movement_id]
```

**Critical checks:**
- ✓ Account space logged as `ms2yt6sp7kwmn11qrupu3` (Casa)
- ✓ Category is either Casa category (starts with Casa space ID in mappings) OR null
- ✓ NO "Category does not belong to account Space" error
- ✓ Import succeeds
- ✓ Cursor advances to 15779

**Step 4: Verify database entries**
```sql
SELECT uid, provider, decision, account_id, category_id, 
       import_success, error_message, created_at
FROM bank_email_processing_log 
WHERE uid = 15779
ORDER BY created_at DESC 
LIMIT 1;
```

Expected:
- `decision`: "imported" (or "duplicate_success" if already imported during testing)
- `account_id`: "nxk4kf3fka5r8a3ozqtks" (now populated!)
- `category_id`: Casa category ID or NULL (not Personal space category)
- `import_success`: true
- `error_message`: NULL

**Step 5: Verify movement in Wallit**
Check the imported movement:
- Account: Tenpo Vista (Casa space)
- Category: Either Casa category or uncategorized (not Personal category)
- Amount/date/description should match UID 15779 email

### Test Cases for Future UIDs

After UID 15779 processes successfully, monitor subsequent emails:

1. **Personal account emails** (BCI, Tenpo Credit, MercadoPago)
   - Should use Personal prompt
   - Should receive Personal categories
   - Existing behavior preserved

2. **Casa account emails** (Tenpo Vista, BCI Casa)
   - Should use Casa prompt
   - Should receive Casa categories
   - New behavior working correctly

3. **Edge cases**
   - Low confidence → `categoryId=null` → import succeeds
   - Ambiguous merchant → `__skip__` → `categoryId=null` → import succeeds
   - No cross-space 400 errors

## Rollback Plan

If issues arise after deployment:

1. **Quick rollback**: Revert to previous commit
   ```bash
   git revert 102afd7
   git push
   ```

2. **Disable category selection**: Set env var
   ```
   CATEGORY_MIN_CONFIDENCE=1.0
   ```
   This will make all categories return null due to confidence threshold

3. **Manual category assignment**: Categories can be assigned manually in Wallit UI

## Future Improvements (Out of Scope)

1. **Dynamic space detection**: Query Wallit API for account spaces instead of static mappings
2. **Per-user prompts**: Support multiple users with different category sets
3. **Category learning**: Track which categories are manually corrected and update prompts
4. **Space transitions**: Handle accounts moving between spaces
5. **Category aliases**: Map similar categories across spaces (e.g., both "Supermercado" categories)

## Summary

✅ **Fixed**: Cross-space category selection that blocked production at UID 15779  
✅ **Improved**: Logging now includes account and category IDs with space context  
✅ **Protected**: Defensive validation prevents future cross-space errors  
✅ **Tested**: 102 tests passing including 18 new space-aware tests  
✅ **Ready**: PR #11 open against master, ready for review and deploy

The worker will now correctly:
- Use Personal categories for Personal accounts
- Use Casa categories for Casa accounts  
- Import with `null` category if no match (instead of failing)
- Never send cross-space categories that cause 400 errors
- Log full context (account/category/space) for debugging
