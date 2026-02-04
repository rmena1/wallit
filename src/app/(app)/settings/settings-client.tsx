'use client'

import { useState } from 'react'
import { createAccount, updateAccount, deleteAccount } from '@/lib/actions/accounts'
import { createCategory, updateCategory, deleteCategory } from '@/lib/actions/categories'
import { formatCurrency } from '@/lib/utils'
import { BANK_NAMES, ACCOUNT_TYPES } from '@/lib/constants'
import type { Category, Account } from '@/lib/db'
import type { AccountWithBalance } from '@/lib/actions/balances'

interface SettingsPageProps {
  accounts: Account[]
  accountBalances: AccountWithBalance[]
  categories: Category[]
}

const inputStyle: React.CSSProperties = {
  width: '100%', height: 44, borderRadius: 10,
  border: '1px solid #2a2a2a', backgroundColor: '#111111',
  fontSize: 15, color: '#e5e5e5', padding: '0 14px', outline: 'none',
}

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  appearance: 'none' as const,
  backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%2371717a' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
  backgroundPosition: 'right 12px center',
  backgroundRepeat: 'no-repeat',
  backgroundSize: '16px',
}

function PlusIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  )
}

function EditIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  )
}

function getAccountIcon(account: Account): string {
  if (account.emoji) return account.emoji
  switch (account.accountType) {
    case 'Crédito': return '💳'
    case 'Corriente': return '🏦'
    case 'Vista': return '👁️'
    case 'Ahorro': return '🐷'
    case 'Prepago': return '💵'
    default: return '🏦'
  }
}

export function SettingsPage({ accounts, accountBalances, categories }: SettingsPageProps) {
  const [accountLoading, setAccountLoading] = useState(false)
  const [accountError, setAccountError] = useState<string | null>(null)
  const [deletingAccountId, setDeletingAccountId] = useState<string | null>(null)
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null)
  const [showAddAccount, setShowAddAccount] = useState(accounts.length === 0)
  const [categoryLoading, setCategoryLoading] = useState(false)
  const [categoryError, setCategoryError] = useState<string | null>(null)
  const [deletingCategoryId, setDeletingCategoryId] = useState<string | null>(null)
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null)

  async function handleAccountSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setAccountError(null)
    setAccountLoading(true)
    try {
      const form = e.currentTarget
      const formData = new FormData(form)
      const result = await createAccount(formData)
      if (!result.success) {
        setAccountError(result.error || 'Error al crear cuenta')
      } else {
        form.reset()
        setShowAddAccount(false)
      }
    } catch {
      setAccountError('Ocurrió un error')
    } finally {
      setAccountLoading(false)
    }
  }

  async function handleAccountUpdate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setAccountError(null)
    setAccountLoading(true)
    try {
      const form = e.currentTarget
      const formData = new FormData(form)
      const result = await updateAccount(formData)
      if (!result.success) {
        setAccountError(result.error || 'Error al actualizar cuenta')
      } else {
        setEditingAccountId(null)
      }
    } catch {
      setAccountError('Ocurrió un error')
    } finally {
      setAccountLoading(false)
    }
  }

  async function handleDeleteAccount(id: string) {
    if (!confirm('¿Eliminar esta cuenta? Los movimientos asociados perderán la referencia.')) return
    setDeletingAccountId(id)
    try {
      await deleteAccount(id)
    } finally {
      setDeletingAccountId(null)
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
        setCategoryError(result.error || 'Error al crear categoría')
      } else {
        form.reset()
      }
    } catch {
      setCategoryError('Ocurrió un error')
    } finally {
      setCategoryLoading(false)
    }
  }

  async function handleDeleteCategory(id: string) {
    if (!confirm('¿Eliminar esta categoría?')) return
    setDeletingCategoryId(id)
    try {
      await deleteCategory(id)
    } finally {
      setDeletingCategoryId(null)
    }
  }

  async function handleCategoryUpdate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setCategoryError(null)
    setCategoryLoading(true)
    try {
      const formData = new FormData(e.currentTarget)
      const result = await updateCategory(formData)
      if (!result.success) {
        setCategoryError(result.error || 'Error al actualizar categoría')
      } else {
        setEditingCategoryId(null)
      }
    } catch {
      setCategoryError('Ocurrió un error')
    } finally {
      setCategoryLoading(false)
    }
  }

  return (
    <>
      {/* Header */}
      <header style={{
        backgroundColor: '#111111',
        borderBottom: '1px solid #1e1e1e',
        padding: '12px 16px',
        position: 'sticky',
        top: 0,
        zIndex: 10,
      }}>
        <div style={{ maxWidth: 540, margin: '0 auto', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <span style={{ fontSize: 17, fontWeight: 700, color: '#f5f5f5' }}>Configuración</span>
        </div>
      </header>

      <main style={{ maxWidth: 540, margin: '0 auto', padding: '16px 16px 96px' }}>
        {/* Accounts Section */}
        <div style={{
          backgroundColor: '#1a1a1a', borderRadius: 16,
          padding: 16, marginBottom: 20,
          border: '1px solid #2a2a2a',
        }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: '#e5e5e5', margin: '0 0 14px' }}>
            🏦 Cuentas Bancarias
          </h2>

          {accountError && (
            <div style={{
              backgroundColor: '#450a0a', border: '1px solid #7f1d1d',
              borderRadius: 10, padding: '10px 14px', marginBottom: 12,
              fontSize: 13, color: '#fca5a5',
            }}>
              {accountError}
            </div>
          )}

          {/* Add Account Toggle / Form */}
          {!showAddAccount ? (
            <button
              onClick={() => setShowAddAccount(true)}
              style={{
                width: '100%', height: 44, borderRadius: 10,
                border: '1px dashed #3f3f46', backgroundColor: 'transparent',
                color: '#22c55e', fontSize: 14, fontWeight: 600,
                cursor: 'pointer', display: 'flex', alignItems: 'center',
                justifyContent: 'center', gap: 6, marginBottom: 16,
                transition: 'all 0.2s ease',
              }}
            >
              <PlusIcon size={16} />
              Agregar Cuenta
            </button>
          ) : (
          <form onSubmit={handleAccountSubmit} style={{
            marginBottom: 16,
            backgroundColor: '#111111', borderRadius: 12, padding: 14,
            border: '1px solid #3f3f46',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#a1a1aa' }}>Nueva cuenta</span>
              {accounts.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowAddAccount(false)}
                  style={{
                    background: 'none', border: 'none', color: '#71717a',
                    fontSize: 13, cursor: 'pointer', padding: '2px 0',
                  }}
                >
                  Cancelar
                </button>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <select name="bankName" required defaultValue="" style={selectStyle}>
                <option value="" disabled>Seleccionar banco</option>
                {BANK_NAMES.map((bank) => (
                  <option key={bank} value={bank}>{bank}</option>
                ))}
              </select>

              <select name="accountType" required defaultValue="" style={selectStyle}>
                <option value="" disabled>Tipo de cuenta</option>
                {ACCOUNT_TYPES.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>

              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  name="lastFourDigits" type="text" placeholder="Últimos 4 dígitos"
                  required maxLength={4} pattern="\d{4}" inputMode="numeric"
                  style={{ ...inputStyle, flex: 1 }}
                />
                <select name="currency" defaultValue="CLP" style={{ ...selectStyle, flex: 1 }}>
                  <option value="CLP">CLP</option>
                  <option value="USD">USD</option>
                </select>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  name="initialBalance" type="text" placeholder="Saldo inicial"
                  inputMode="decimal"
                  style={{ ...inputStyle, flex: 1 }}
                />
                <input
                  name="emoji" type="text" placeholder="🏦" maxLength={4}
                  style={{ ...inputStyle, width: 52, flex: 'none', textAlign: 'center', fontSize: 18, padding: 0 }}
                />
                <input
                  name="color" type="color" defaultValue="#3B82F6"
                  style={{ ...inputStyle, width: 52, flex: 'none', padding: 4, cursor: 'pointer' }}
                />
              </div>

              <button
                type="submit" disabled={accountLoading}
                style={{
                  height: 44, borderRadius: 10, border: 'none',
                  background: accountLoading ? '#27272a' : 'linear-gradient(135deg, #22c55e, #16a34a)',
                  color: '#fff', fontSize: 14, fontWeight: 600,
                  cursor: accountLoading ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}
              >
                <PlusIcon size={16} />
                Agregar Cuenta
              </button>
            </div>
          </form>
          )}

          {/* Account List */}
          {accounts.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#52525b', padding: '16px 0', fontSize: 13 }}>
              Sin cuentas aún
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {accounts.map((acc) => {
                const balanceData = accountBalances.find(b => b.id === acc.id)
                const balance = balanceData?.balance ?? 0
                const isEditing = editingAccountId === acc.id

                if (isEditing) {
                  return (
                    <form key={acc.id} onSubmit={handleAccountUpdate} style={{
                      backgroundColor: '#111111', borderRadius: 12,
                      padding: 12, border: '1px solid #3f3f46',
                    }}>
                      <input type="hidden" name="id" value={acc.id} />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <select name="bankName" required defaultValue={acc.bankName} style={selectStyle}>
                          {BANK_NAMES.map((bank) => (
                            <option key={bank} value={bank}>{bank}</option>
                          ))}
                        </select>
                        <select name="accountType" required defaultValue={acc.accountType} style={selectStyle}>
                          {ACCOUNT_TYPES.map((type) => (
                            <option key={type} value={type}>{type}</option>
                          ))}
                        </select>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <input
                            name="lastFourDigits" type="text" defaultValue={acc.lastFourDigits}
                            required maxLength={4} pattern="\d{4}" inputMode="numeric"
                            placeholder="Últimos 4 dígitos"
                            style={{ ...inputStyle, flex: 1 }}
                          />
                          <select name="currency" defaultValue={acc.currency} style={{ ...selectStyle, flex: 1 }}>
                            <option value="CLP">CLP</option>
                            <option value="USD">USD</option>
                          </select>
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <input
                            name="initialBalance" type="text"
                            defaultValue={(acc.initialBalance / 100).toFixed(2)}
                            inputMode="decimal" placeholder="Saldo inicial"
                            style={{ ...inputStyle, flex: 1 }}
                          />
                          <input
                            name="emoji" type="text" defaultValue={acc.emoji || ''} placeholder="🏦" maxLength={4}
                            style={{ ...inputStyle, width: 52, flex: 'none', textAlign: 'center', fontSize: 18, padding: 0 }}
                          />
                          <input
                            name="color" type="color" defaultValue={acc.color || '#3B82F6'}
                            style={{ ...inputStyle, width: 52, flex: 'none', padding: 4, cursor: 'pointer' }}
                          />
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button
                            type="submit" disabled={accountLoading}
                            style={{
                              flex: 1, height: 38, borderRadius: 8, border: 'none',
                              background: 'linear-gradient(135deg, #22c55e, #16a34a)',
                              color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                            }}
                          >
                            Guardar
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingAccountId(null)}
                            style={{
                              flex: 1, height: 38, borderRadius: 8,
                              border: '1px solid #2a2a2a', backgroundColor: '#1a1a1a',
                              color: '#a1a1aa', fontSize: 13, fontWeight: 500, cursor: 'pointer',
                            }}
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    </form>
                  )
                }

                return (
                  <div key={acc.id} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    backgroundColor: '#111111', borderRadius: 12,
                    padding: '12px 14px',
                    border: '1px solid #2a2a2a',
                    opacity: deletingAccountId === acc.id ? 0.4 : 1,
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 18 }}>{getAccountIcon(acc)}</span>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 600, color: acc.color || '#e5e5e5' }}>
                            {acc.bankName}
                          </div>
                          <div style={{ fontSize: 12, color: '#71717a' }}>
                            {acc.accountType} · ···{acc.lastFourDigits} · {acc.currency}
                          </div>
                        </div>
                      </div>
                      <div style={{ marginTop: 6, display: 'flex', gap: 12 }}>
                        <div style={{ fontSize: 12, color: '#52525b' }}>
                          Saldo inicial: {formatCurrency(acc.initialBalance, acc.currency)}
                        </div>
                        <div style={{
                          fontSize: 13, fontWeight: 600,
                          color: balance >= 0 ? '#4ade80' : '#f87171',
                        }}>
                          Balance: {formatCurrency(balance, acc.currency)}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
                      <button
                        onClick={() => setEditingAccountId(acc.id)}
                        style={{
                          background: 'none', border: 'none',
                          color: '#71717a', cursor: 'pointer', padding: 6,
                        }}
                      >
                        <EditIcon />
                      </button>
                      <button
                        onClick={() => handleDeleteAccount(acc.id)}
                        disabled={deletingAccountId === acc.id}
                        style={{
                          background: 'none', border: 'none',
                          color: '#52525b', cursor: 'pointer', padding: 6,
                        }}
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Categories Section */}
        <div style={{
          backgroundColor: '#1a1a1a', borderRadius: 16,
          padding: 16, marginBottom: 20,
          border: '1px solid #2a2a2a',
        }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: '#e5e5e5', margin: '0 0 14px' }}>
            🏷️ Categorías
          </h2>

          {categoryError && (
            <div style={{
              backgroundColor: '#450a0a', border: '1px solid #7f1d1d',
              borderRadius: 10, padding: '10px 14px', marginBottom: 12,
              fontSize: 13, color: '#fca5a5',
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
                  border: '1px solid #2a2a2a', backgroundColor: '#111111',
                  fontSize: 18, textAlign: 'center', padding: 0, outline: 'none',
                  color: '#e5e5e5',
                }}
              />
              <input
                name="name" type="text" placeholder="Nombre de categoría" required
                style={{ ...inputStyle, flex: 1 }}
              />
              <button
                type="submit" disabled={categoryLoading}
                style={{
                  width: 44, height: 44, borderRadius: 10, border: 'none',
                  background: categoryLoading ? '#27272a' : 'linear-gradient(135deg, #22c55e, #16a34a)',
                  color: '#fff', fontSize: 18, cursor: categoryLoading ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <PlusIcon size={18} />
              </button>
            </div>
          </form>

          {categories.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#52525b', padding: '16px 0', fontSize: 13 }}>
              Sin categorías aún
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {categories.map((cat) => {
                if (editingCategoryId === cat.id) {
                  return (
                    <form key={cat.id} onSubmit={handleCategoryUpdate} style={{
                      display: 'flex', gap: 8, alignItems: 'center',
                      backgroundColor: '#111111', borderRadius: 12,
                      padding: '8px 10px', border: '1px solid #3f3f46',
                    }}>
                      <input type="hidden" name="id" value={cat.id} />
                      <input
                        name="emoji" type="text" defaultValue={cat.emoji} required maxLength={4}
                        style={{
                          width: 44, height: 40, borderRadius: 8,
                          border: '1px solid #2a2a2a', backgroundColor: '#1a1a1a',
                          fontSize: 18, textAlign: 'center', padding: 0, outline: 'none',
                          color: '#e5e5e5',
                        }}
                      />
                      <input
                        name="name" type="text" defaultValue={cat.name} required
                        autoFocus
                        style={{ ...inputStyle, flex: 1, height: 40 }}
                      />
                      <button
                        type="submit" disabled={categoryLoading}
                        style={{
                          height: 40, padding: '0 12px', borderRadius: 8, border: 'none',
                          background: 'linear-gradient(135deg, #22c55e, #16a34a)',
                          color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        ✓
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingCategoryId(null)}
                        style={{
                          height: 40, padding: '0 10px', borderRadius: 8,
                          border: '1px solid #2a2a2a', backgroundColor: '#1a1a1a',
                          color: '#a1a1aa', fontSize: 13, cursor: 'pointer',
                        }}
                      >
                        ✕
                      </button>
                    </form>
                  )
                }
                return (
                  <div key={cat.id} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    backgroundColor: '#111111', borderRadius: 12,
                    padding: '10px 14px',
                    border: '1px solid #2a2a2a',
                    opacity: deletingCategoryId === cat.id ? 0.4 : 1,
                    cursor: 'pointer',
                  }}
                  onClick={() => setEditingCategoryId(cat.id)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 20 }}>{cat.emoji}</span>
                      <span style={{ fontSize: 14, color: '#d4d4d8', fontWeight: 500 }}>{cat.name}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditingCategoryId(cat.id) }}
                        style={{
                          background: 'none', border: 'none',
                          color: '#71717a', cursor: 'pointer', padding: 6,
                        }}
                      >
                        <EditIcon />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteCategory(cat.id) }}
                        disabled={deletingCategoryId === cat.id}
                        style={{
                          background: 'none', border: 'none',
                          color: '#52525b', cursor: 'pointer', padding: 6,
                        }}
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </main>
    </>
  )
}
