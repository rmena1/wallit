'use client'

import { useState } from 'react'
import { logout } from '@/lib/actions/auth'
import { createMovement, deleteMovement } from '@/lib/actions/movements'
import { createCategory, deleteCategory } from '@/lib/actions/categories'
import { createAccount, deleteAccount } from '@/lib/actions/accounts'
import { BANK_NAMES, ACCOUNT_TYPES } from '@/lib/constants'
import { today, formatDateDisplay, formatMoney, parseMoney } from '@/lib/utils'
import type { Category, Account } from '@/lib/db'

interface MovementWithCategory {
  id: string
  userId: string
  categoryId: string | null
  accountId: string | null
  name: string
  date: string
  amount: number
  type: 'income' | 'expense'
  createdAt: Date
  updatedAt: Date
  categoryName: string | null
  categoryEmoji: string | null
  accountBankName: string | null
  accountLastFour: string | null
}

interface DashboardProps {
  email: string
  movements: MovementWithCategory[]
  accounts: Account[]
  categories: Category[]
  balance: number
  totalIncome: number
  totalExpense: number
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  )
}

function PlusIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

const selectStyle: React.CSSProperties = {
  width: '100%', height: 44, borderRadius: 10,
  border: '1px solid #e5e7eb', backgroundColor: '#fafafa',
  fontSize: 15, color: '#1a1a1a', padding: '0 14px', outline: 'none',
  appearance: 'none',
  backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%239ca3af' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
  backgroundPosition: 'right 12px center',
  backgroundRepeat: 'no-repeat',
  backgroundSize: '16px',
}

export function Dashboard({ email, movements, accounts, categories, balance, totalIncome, totalExpense }: DashboardProps) {
  const [showForm, setShowForm] = useState(false)
  const [showCategories, setShowCategories] = useState(false)
  const [showAccounts, setShowAccounts] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [categoryLoading, setCategoryLoading] = useState(false)
  const [categoryError, setCategoryError] = useState<string | null>(null)
  const [deletingCategoryId, setDeletingCategoryId] = useState<string | null>(null)
  const [accountLoading, setAccountLoading] = useState(false)
  const [accountError, setAccountError] = useState<string | null>(null)
  const [deletingAccountId, setDeletingAccountId] = useState<string | null>(null)

  const hasAccounts = accounts.length > 0

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const form = e.currentTarget
      const formData = new FormData(form)
      const amountStr = formData.get('amount') as string
      const cents = parseMoney(amountStr)
      formData.set('amount', cents.toString())
      const result = await createMovement(formData)
      if (!result.success) {
        setError(result.error || 'Failed to create movement')
      } else {
        form.reset()
        setShowForm(false)
      }
    } catch {
      setError('An error occurred')
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this movement?')) return
    setDeletingId(id)
    try {
      await deleteMovement(id)
    } finally {
      setDeletingId(null)
    }
  }

  async function handleCategorySubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setCategoryError(null)
    setCategoryLoading(true)
    try {
      const form = e.currentTarget
      const formData = new FormData(form)
      const result = await createCategory(formData)
      if (!result.success) {
        setCategoryError(result.error || 'Failed to create category')
      } else {
        form.reset()
      }
    } catch {
      setCategoryError('An error occurred')
    } finally {
      setCategoryLoading(false)
    }
  }

  async function handleDeleteCategory(id: string) {
    if (!confirm('Delete this category?')) return
    setDeletingCategoryId(id)
    try {
      await deleteCategory(id)
    } finally {
      setDeletingCategoryId(null)
    }
  }

  async function handleAccountSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setAccountError(null)
    setAccountLoading(true)
    try {
      const form = e.currentTarget
      const formData = new FormData(form)
      const result = await createAccount(formData)
      if (!result.success) {
        setAccountError(result.error || 'Failed to create account')
      } else {
        form.reset()
      }
    } catch {
      setAccountError('An error occurred')
    } finally {
      setAccountLoading(false)
    }
  }

  async function handleDeleteAccount(id: string) {
    if (!confirm('Delete this account?')) return
    setDeletingAccountId(id)
    try {
      await deleteAccount(id)
    } finally {
      setDeletingAccountId(null)
    }
  }

  function closeAllPanels() {
    setShowForm(false)
    setShowCategories(false)
    setShowAccounts(false)
  }

  return (
    <div style={{ minHeight: '100dvh', backgroundColor: '#f9fafb' }}>
      {/* Header */}
      <header style={{
        backgroundColor: '#fff',
        borderBottom: '1px solid #f0f0f0',
        padding: '12px 16px',
        position: 'sticky',
        top: 0,
        zIndex: 10,
      }}>
        <div style={{ maxWidth: 540, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: 'linear-gradient(135deg, #22c55e, #16a34a)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16,
            }}>
              💰
            </div>
            <span style={{ fontSize: 17, fontWeight: 700, color: '#1a1a1a' }}>wallit</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, color: '#9ca3af', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email}</span>
            <button
              onClick={() => logout()}
              style={{
                padding: '6px 12px', borderRadius: 8,
                border: '1px solid #e5e7eb', backgroundColor: '#fff',
                fontSize: 13, fontWeight: 500, color: '#6b7280', cursor: 'pointer',
              }}
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main style={{ maxWidth: 540, margin: '0 auto', padding: '16px 16px 80px' }}>
        {/* Balance Card */}
        <div style={{
          background: 'linear-gradient(135deg, #18181b 0%, #27272a 100%)',
          borderRadius: 20, padding: '20px 20px 16px', marginBottom: 16,
          color: '#fff',
        }}>
          <div style={{ fontSize: 13, color: '#a1a1aa', marginBottom: 4 }}>Balance</div>
          <div style={{
            fontSize: 28, fontWeight: 700, letterSpacing: '-0.5px',
            color: balance >= 0 ? '#4ade80' : '#f87171',
            whiteSpace: 'nowrap',
          }}>
            {formatMoney(balance)}
          </div>
          <div style={{
            display: 'flex', gap: 16, marginTop: 16, paddingTop: 16,
            borderTop: '1px solid rgba(255,255,255,0.1)',
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: '#a1a1aa', marginBottom: 2 }}>Income</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#4ade80', whiteSpace: 'nowrap' }}>
                {formatMoney(totalIncome)}
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: '#a1a1aa', marginBottom: 2 }}>Expenses</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#f87171', whiteSpace: 'nowrap' }}>
                {formatMoney(totalExpense)}
              </div>
            </div>
          </div>
        </div>

        {/* No accounts empty state */}
        {!hasAccounts && !showAccounts && (
          <div style={{
            backgroundColor: '#fff', borderRadius: 16,
            padding: '32px 20px', textAlign: 'center',
            border: '1px solid #f0f0f0', marginBottom: 20,
          }}>
            <span style={{ fontSize: 40, display: 'block', marginBottom: 8 }}>🏦</span>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#1a1a1a', marginBottom: 4 }}>
              No accounts yet
            </div>
            <div style={{ fontSize: 14, color: '#a1a1aa', marginBottom: 16 }}>
              Add a bank account to start tracking your movements
            </div>
            <button
              onClick={() => { closeAllPanels(); setShowAccounts(true) }}
              style={{
                padding: '10px 24px', borderRadius: 12, border: 'none',
                background: 'linear-gradient(135deg, #22c55e, #16a34a)',
                color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(34,197,94,0.25)',
              }}
            >
              Add Account
            </button>
          </div>
        )}

        {/* Action Buttons — only show "Add Movement" if user has accounts */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
          {hasAccounts && (
            <button
              onClick={() => { const next = !showForm; closeAllPanels(); if (next) setShowForm(true) }}
              style={{
                flex: 1, height: 48, borderRadius: 12, border: 'none',
                background: showForm ? '#f4f4f5' : 'linear-gradient(135deg, #22c55e, #16a34a)',
                color: showForm ? '#52525b' : '#fff',
                fontSize: 15, fontWeight: 600, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                boxShadow: showForm ? 'none' : '0 2px 8px rgba(34,197,94,0.25)',
                transition: 'all 0.2s ease',
              }}
            >
              <PlusIcon size={18} />
              Add Movement
            </button>
          )}
          <button
            onClick={() => { const next = !showAccounts; closeAllPanels(); if (next) setShowAccounts(true) }}
            style={{
              width: hasAccounts ? 48 : undefined,
              flex: hasAccounts ? undefined : 1,
              height: 48, borderRadius: 12,
              border: '1px solid #e5e7eb',
              backgroundColor: showAccounts ? '#f4f4f5' : '#fff',
              fontSize: hasAccounts ? 18 : 15,
              fontWeight: hasAccounts ? undefined : 600,
              color: hasAccounts ? undefined : '#52525b',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: hasAccounts ? undefined : 6,
              transition: 'all 0.2s ease',
            }}
            title="Manage Accounts"
          >
            🏦{!hasAccounts && ' Manage Accounts'}
          </button>
          <button
            onClick={() => { const next = !showCategories; closeAllPanels(); if (next) setShowCategories(true) }}
            style={{
              width: 48, height: 48, borderRadius: 12,
              border: '1px solid #e5e7eb',
              backgroundColor: showCategories ? '#f4f4f5' : '#fff',
              fontSize: 18, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.2s ease',
            }}
            title="Manage Categories"
          >
            🏷️
          </button>
        </div>

        {/* Accounts Section */}
        {showAccounts && (
          <div style={{
            backgroundColor: '#fff', borderRadius: 16,
            padding: 16, marginBottom: 20,
            border: '1px solid #f0f0f0',
          }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: '#1a1a1a', margin: '0 0 12px' }}>
              Accounts
            </h2>

            {accountError && (
              <div style={{
                backgroundColor: '#fef2f2', border: '1px solid #fecaca',
                borderRadius: 10, padding: '10px 14px', marginBottom: 12,
                fontSize: 13, color: '#dc2626',
              }}>
                {accountError}
              </div>
            )}

            <form onSubmit={handleAccountSubmit} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <select name="bankName" required defaultValue="" style={selectStyle}>
                  <option value="" disabled>Select bank</option>
                  {BANK_NAMES.map((bank) => (
                    <option key={bank} value={bank}>{bank}</option>
                  ))}
                </select>

                <select name="accountType" required defaultValue="" style={selectStyle}>
                  <option value="" disabled>Account type</option>
                  {ACCOUNT_TYPES.map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>

                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    name="lastFourDigits" type="text" placeholder="Last 4 digits"
                    required maxLength={4} pattern="\d{4}" inputMode="numeric"
                    style={{
                      flex: 1, height: 44, borderRadius: 10,
                      border: '1px solid #e5e7eb', backgroundColor: '#fafafa',
                      fontSize: 15, color: '#1a1a1a', padding: '0 14px', outline: 'none',
                    }}
                  />
                  <button
                    type="submit" disabled={accountLoading}
                    style={{
                      height: 44, padding: '0 16px', borderRadius: 10, border: 'none',
                      background: accountLoading ? '#d4d4d8' : 'linear-gradient(135deg, #22c55e, #16a34a)',
                      color: '#fff', fontSize: 14, fontWeight: 600,
                      cursor: accountLoading ? 'not-allowed' : 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <PlusIcon size={16} />
                    Add
                  </button>
                </div>
              </div>
            </form>

            {accounts.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#a1a1aa', padding: '16px 0', fontSize: 13 }}>
                No accounts yet
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {accounts.map((acc) => (
                  <div key={acc.id} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    backgroundColor: '#f4f4f5', borderRadius: 12,
                    padding: '10px 12px',
                    opacity: deletingAccountId === acc.id ? 0.4 : 1,
                  }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 500, color: '#1a1a1a' }}>
                        {acc.bankName}
                      </div>
                      <div style={{ fontSize: 12, color: '#a1a1aa' }}>
                        {acc.accountType} · ···{acc.lastFourDigits}
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteAccount(acc.id)}
                      disabled={deletingAccountId === acc.id}
                      style={{
                        background: 'none', border: 'none',
                        color: '#a1a1aa', cursor: 'pointer', padding: 4,
                      }}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Categories Section */}
        {showCategories && (
          <div style={{
            backgroundColor: '#fff', borderRadius: 16,
            padding: 16, marginBottom: 20,
            border: '1px solid #f0f0f0',
          }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: '#1a1a1a', margin: '0 0 12px' }}>
              Categories
            </h2>

            {categoryError && (
              <div style={{
                backgroundColor: '#fef2f2', border: '1px solid #fecaca',
                borderRadius: 10, padding: '10px 14px', marginBottom: 12,
                fontSize: 13, color: '#dc2626',
              }}>
                {categoryError}
              </div>
            )}

            <form onSubmit={handleCategorySubmit} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  name="emoji" type="text" placeholder="🍕" required maxLength={4}
                  style={{
                    width: 48, height: 44, borderRadius: 10,
                    border: '1px solid #e5e7eb', backgroundColor: '#fafafa',
                    fontSize: 18, textAlign: 'center', padding: 0, outline: 'none',
                  }}
                />
                <input
                  name="name" type="text" placeholder="Category name" required
                  style={{
                    flex: 1, height: 44, borderRadius: 10,
                    border: '1px solid #e5e7eb', backgroundColor: '#fafafa',
                    fontSize: 15, color: '#1a1a1a', padding: '0 14px', outline: 'none',
                  }}
                />
                <button
                  type="submit" disabled={categoryLoading}
                  style={{
                    width: 44, height: 44, borderRadius: 10, border: 'none',
                    background: categoryLoading ? '#d4d4d8' : 'linear-gradient(135deg, #22c55e, #16a34a)',
                    color: '#fff', fontSize: 18, cursor: categoryLoading ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <PlusIcon size={18} />
                </button>
              </div>
            </form>

            {categories.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#a1a1aa', padding: '16px 0', fontSize: 13 }}>
                No categories yet
              </div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {categories.map((cat) => (
                  <div key={cat.id} style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    backgroundColor: '#f4f4f5', borderRadius: 20,
                    padding: '6px 10px', fontSize: 13,
                    opacity: deletingCategoryId === cat.id ? 0.4 : 1,
                  }}>
                    <span>{cat.emoji}</span>
                    <span style={{ color: '#3f3f46' }}>{cat.name}</span>
                    <button
                      onClick={() => handleDeleteCategory(cat.id)}
                      disabled={deletingCategoryId === cat.id}
                      style={{
                        background: 'none', border: 'none', fontSize: 14,
                        color: '#a1a1aa', cursor: 'pointer', padding: '0 0 0 2px',
                        lineHeight: 1,
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Movement Form */}
        {showForm && (
          <div style={{
            backgroundColor: '#fff', borderRadius: 16,
            padding: 16, marginBottom: 20,
            border: '1px solid #f0f0f0',
          }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: '#1a1a1a', margin: '0 0 14px' }}>
              New Movement
            </h2>

            {error && (
              <div style={{
                backgroundColor: '#fef2f2', border: '1px solid #fecaca',
                borderRadius: 10, padding: '10px 14px', marginBottom: 12,
                fontSize: 13, color: '#dc2626',
              }}>
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {/* Type Toggle */}
                <div style={{
                  display: 'flex', backgroundColor: '#f4f4f5', borderRadius: 10,
                  padding: 3, gap: 3,
                }}>
                  {(['expense', 'income'] as const).map((t) => (
                    <label key={t} style={{
                      flex: 1, textAlign: 'center', cursor: 'pointer',
                    }}>
                      <input
                        type="radio" name="type" value={t}
                        defaultChecked={t === 'expense'}
                        style={{ display: 'none' }}
                        className="type-radio"
                      />
                      <span className={`type-label type-label-${t}`} style={{
                        display: 'block', padding: '8px 0', borderRadius: 8,
                        fontSize: 14, fontWeight: 500,
                        transition: 'all 0.2s ease',
                      }}>
                        {t === 'expense' ? '↓ Expense' : '↑ Income'}
                      </span>
                    </label>
                  ))}
                </div>

                {/* Account selector (required) */}
                <select name="accountId" required defaultValue="" style={selectStyle}>
                  <option value="" disabled>Select account</option>
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.bankName} · {acc.accountType} · ···{acc.lastFourDigits}
                    </option>
                  ))}
                </select>

                <input
                  name="name" type="text" placeholder="What was it for?"
                  required autoComplete="off"
                  style={{
                    width: '100%', height: 44, borderRadius: 10,
                    border: '1px solid #e5e7eb', backgroundColor: '#fafafa',
                    fontSize: 15, color: '#1a1a1a', padding: '0 14px', outline: 'none',
                  }}
                />

                <div style={{ display: 'flex', gap: 10 }}>
                  <input
                    name="amount" type="text" placeholder="0.00"
                    required inputMode="decimal" autoComplete="off"
                    style={{
                      flex: 1, height: 44, borderRadius: 10,
                      border: '1px solid #e5e7eb', backgroundColor: '#fafafa',
                      fontSize: 15, color: '#1a1a1a', padding: '0 14px', outline: 'none',
                    }}
                  />
                  <input
                    name="date" type="date" defaultValue={today()} required
                    style={{
                      flex: 1, height: 44, borderRadius: 10,
                      border: '1px solid #e5e7eb', backgroundColor: '#fafafa',
                      fontSize: 15, color: '#1a1a1a', padding: '0 14px', outline: 'none',
                    }}
                  />
                </div>

                <select name="categoryId" defaultValue="" style={selectStyle}>
                  <option value="">No category</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.emoji} {cat.name}
                    </option>
                  ))}
                </select>

                <button
                  type="submit" disabled={loading}
                  style={{
                    width: '100%', height: 44, borderRadius: 10, border: 'none',
                    background: loading ? '#d4d4d8' : 'linear-gradient(135deg, #22c55e, #16a34a)',
                    color: '#fff', fontSize: 15, fontWeight: 600,
                    cursor: loading ? 'not-allowed' : 'pointer',
                    marginTop: 2,
                  }}
                >
                  {loading ? 'Saving...' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Movements List */}
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: '#1a1a1a', margin: '0 0 12px' }}>
            Recent Movements
          </h2>

          {movements.length === 0 ? (
            <div style={{
              backgroundColor: '#fff', borderRadius: 16,
              padding: '40px 20px', textAlign: 'center', color: '#a1a1aa',
              border: '1px solid #f0f0f0',
            }}>
              <span style={{ fontSize: 40, display: 'block', marginBottom: 8 }}>📊</span>
              <span style={{ fontSize: 14 }}>No movements yet</span>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {movements.map((m) => (
                <div
                  key={m.id}
                  style={{
                    backgroundColor: '#fff', borderRadius: 12,
                    padding: '12px 14px',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    border: '1px solid #f0f0f0',
                    opacity: deletingId === m.id ? 0.4 : 1,
                    transition: 'opacity 0.2s ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: 10,
                      backgroundColor: m.categoryEmoji ? '#f4f4f5' : (m.type === 'income' ? '#ecfdf5' : '#fef2f2'),
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 16, flexShrink: 0,
                    }}>
                      {m.categoryEmoji || (m.type === 'income' ? '↑' : '↓')}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{
                        fontSize: 15, fontWeight: 500, color: '#1a1a1a',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {m.name}
                      </div>
                      <div style={{ fontSize: 12, color: '#a1a1aa', marginTop: 1 }}>
                        {formatDateDisplay(m.date)}
                        {m.categoryName && (
                          <span> · {m.categoryName}</span>
                        )}
                        {m.accountBankName && (
                          <span> · {m.accountBankName} ···{m.accountLastFour}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, marginLeft: 8 }}>
                    <span style={{
                      fontSize: 15, fontWeight: 600,
                      color: m.type === 'income' ? '#16a34a' : '#ef4444',
                      whiteSpace: 'nowrap',
                    }}>
                      {m.type === 'income' ? '+' : '-'}{formatMoney(m.amount)}
                    </span>
                    <button
                      onClick={() => handleDelete(m.id)}
                      disabled={deletingId === m.id}
                      style={{
                        width: 30, height: 30, borderRadius: 8,
                        border: 'none', backgroundColor: 'transparent',
                        cursor: 'pointer', display: 'flex',
                        alignItems: 'center', justifyContent: 'center',
                        color: '#d4d4d8',
                      }}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      <style>{`
        .type-radio:checked + .type-label {
          background: #fff;
          box-shadow: 0 1px 3px rgba(0,0,0,0.08);
        }
        .type-radio:not(:checked) + .type-label {
          color: #a1a1aa;
        }
        .type-radio:checked + .type-label-expense {
          color: #ef4444;
        }
        .type-radio:checked + .type-label-income {
          color: #22c55e;
        }
      `}</style>
    </div>
  )
}
