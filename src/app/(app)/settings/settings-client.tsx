'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createAccount, updateAccount, deleteAccount, reorderAccounts } from '@/lib/actions/accounts'
import { createCategory, updateCategory, deleteCategory } from '@/lib/actions/categories'
import { addSpaceMember, archiveSpace, createSpace, leaveSpace, removeSpaceMember, updateSpace } from '@/lib/actions/spaces'
import { formatCurrency } from '@/lib/utils'
import { BANK_NAMES, ACCOUNT_TYPES } from '@/lib/constants'
import type { Category, Account } from '@/lib/db'
import type { AccountWithBalance } from '@/lib/actions/balances'
import type { AvailableSpace } from '@/lib/spaces'

interface SettingsPageProps {
  accounts: Account[]
  accountBalances: AccountWithBalance[]
  categories: Category[]
  spaces: AvailableSpace[]
  currentSpace: AvailableSpace
  members: { userId: string; email: string; role: 'owner' | 'member' }[]
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

function DragHandleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="9" cy="5" r="1.5" />
      <circle cx="15" cy="5" r="1.5" />
      <circle cx="9" cy="12" r="1.5" />
      <circle cx="15" cy="12" r="1.5" />
      <circle cx="9" cy="19" r="1.5" />
      <circle cx="15" cy="19" r="1.5" />
    </svg>
  )
}

function getAccountIcon(account: Account): string {
  if (account.emoji) return account.emoji
  switch (account.accountType) {
    case 'Crédito':
    case 'credit': return '💳'
    case 'Corriente': return '🏦'
    case 'Vista': return '👁️'
    case 'Ahorro': return '🐷'
    case 'Prepago': return '💵'
    default: return '🏦'
  }
}

export function SettingsPage({ accounts, accountBalances, categories, currentSpace, members }: SettingsPageProps) {
  const router = useRouter()
  const [orderedAccounts, setOrderedAccounts] = useState(accounts)
  const [accountLoading, setAccountLoading] = useState(false)
  const [accountError, setAccountError] = useState<string | null>(null)
  const [deletingAccountId, setDeletingAccountId] = useState<string | null>(null)
  const [draggingAccountId, setDraggingAccountId] = useState<string | null>(null)
  const [reorderingAccounts, setReorderingAccounts] = useState(false)
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null)
  const [newAccountIsInvestment, setNewAccountIsInvestment] = useState(false)
  const [newAccountType, setNewAccountType] = useState('')
  const [editingAccountIsInvestment, setEditingAccountIsInvestment] = useState<Record<string, boolean>>({})
  const [editingAccountType, setEditingAccountType] = useState<Record<string, string>>({})
  const [showAddAccount, setShowAddAccount] = useState(accounts.length === 0)
  const [localCategories, setLocalCategories] = useState(categories)
  const [categoryLoading, setCategoryLoading] = useState(false)
  const [categoryError, setCategoryError] = useState<string | null>(null)
  const [deletingCategoryId, setDeletingCategoryId] = useState<string | null>(null)
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null)
  const [spaceError, setSpaceError] = useState<string | null>(null)
  const [spaceLoading, setSpaceLoading] = useState(false)

  useEffect(() => {
    setOrderedAccounts(accounts)
  }, [accounts])

  useEffect(() => {
    setLocalCategories(categories)
  }, [categories])

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
        if (result.account) {
          setOrderedAccounts(prev => [...prev, result.account!].sort((a, b) => a.sortOrder - b.sortOrder))
        }
        form.reset()
        setNewAccountIsInvestment(false)
        setNewAccountType('')
        setShowAddAccount(false)
        router.refresh()
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
      const updatedId = formData.get('id') as string | null
      const result = await updateAccount(formData)
      if (!result.success) {
        setAccountError(result.error || 'Error al actualizar cuenta')
      } else {
        setEditingAccountId(null)
        router.refresh()
        if (updatedId) {
          setEditingAccountIsInvestment((prev) => {
            const next = { ...prev }
            delete next[updatedId]
            return next
          })
          setEditingAccountType((prev) => {
            const next = { ...prev }
            delete next[updatedId]
            return next
          })
        }
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
      const result = await deleteAccount(id)
      if (!result.success) {
        setAccountError(result.error || 'Error al eliminar cuenta')
      } else {
        setOrderedAccounts(prev => prev.filter(account => account.id !== id))
        router.refresh()
      }
    } finally {
      setDeletingAccountId(null)
    }
  }

  async function persistAccountOrder(nextAccounts: Account[]) {
    setReorderingAccounts(true)
    setAccountError(null)
    try {
      const result = await reorderAccounts(nextAccounts.map((account) => account.id))
      if (!result.success) {
        setOrderedAccounts(accounts)
        setAccountError(result.error || 'Error al reordenar cuentas')
      }
    } catch {
      setOrderedAccounts(accounts)
      setAccountError('Ocurrió un error al reordenar cuentas')
    } finally {
      setReorderingAccounts(false)
    }
  }

  function moveAccount(fromId: string, toId: string) {
    if (fromId === toId || editingAccountId) return

    const fromIndex = orderedAccounts.findIndex((account) => account.id === fromId)
    const toIndex = orderedAccounts.findIndex((account) => account.id === toId)
    if (fromIndex < 0 || toIndex < 0) return

    const nextAccounts = [...orderedAccounts]
    const [movedAccount] = nextAccounts.splice(fromIndex, 1)
    nextAccounts.splice(toIndex, 0, movedAccount)
    setOrderedAccounts(nextAccounts)
    void persistAccountOrder(nextAccounts)
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
        if (result.category) {
          setLocalCategories(prev => [...prev, result.category!].sort((a, b) => a.name.localeCompare(b.name)))
        }
        form.reset()
        router.refresh()
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
      const result = await deleteCategory(id)
      if (!result.success) {
        setCategoryError(result.error || 'Error al eliminar categoría')
      } else {
        setLocalCategories(prev => prev.filter(category => category.id !== id))
        router.refresh()
      }
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
        if (result.category) {
          setLocalCategories(prev => prev.map(category => category.id === result.category!.id ? result.category! : category).sort((a, b) => a.name.localeCompare(b.name)))
        }
        setEditingCategoryId(null)
        router.refresh()
      }
    } catch {
      setCategoryError('Ocurrió un error')
    } finally {
      setCategoryLoading(false)
    }
  }

  async function runSpaceAction(action: () => Promise<unknown>) {
    setSpaceLoading(true)
    setSpaceError(null)
    try {
      const result = await action()
      if (result && typeof result === 'object' && 'success' in result && result.success === false) {
        setSpaceError('error' in result && typeof result.error === 'string' ? result.error : 'Ocurrió un error')
        return
      }
      router.refresh()
    } catch (error) {
      setSpaceError(error instanceof Error ? error.message : 'Ocurrió un error')
    } finally {
      setSpaceLoading(false)
    }
  }

  async function handleCreateSpace(formData: FormData) {
    await runSpaceAction(() => createSpace({
      name: String(formData.get('name') ?? ''),
      emoji: String(formData.get('emoji') ?? ''),
    }))
  }

  async function handleUpdateSpace(formData: FormData) {
    await runSpaceAction(() => updateSpace({
      spaceId: currentSpace.id,
      name: String(formData.get('name') ?? ''),
      emoji: String(formData.get('emoji') ?? ''),
    }))
  }

  async function handleAddMember(formData: FormData) {
    await runSpaceAction(() => addSpaceMember({
      spaceId: currentSpace.id,
      email: String(formData.get('email') ?? ''),
    }))
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
        {/* Spaces Section */}
        <div style={{
          backgroundColor: '#101827', borderRadius: 16,
          padding: 16, marginBottom: 20,
          border: '1px solid #1f3a5f',
        }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: '#e5e5e5', margin: '0 0 6px' }}>
            {currentSpace.emoji} Spaces
          </h2>
          <p style={{ fontSize: 13, color: '#a1a1aa', margin: '0 0 14px' }}>
            Space activo: <strong style={{ color: '#f5f5f5' }}>{currentSpace.emoji} {currentSpace.name}</strong> · {currentSpace.role === 'owner' ? 'Owner' : 'Member'}
          </p>

          {spaceError && (
            <div style={{ backgroundColor: '#450a0a', border: '1px solid #7f1d1d', borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#fca5a5' }}>
              {spaceError}
            </div>
          )}

          <form action={handleCreateSpace} style={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: 8, marginBottom: 14 }}>
            <input name="emoji" aria-label="Emoji del Space" placeholder="🏠" maxLength={4} style={inputStyle} />
            <input name="name" aria-label="Nombre del Space" placeholder="Nuevo Space" required style={inputStyle} />
            <button disabled={spaceLoading} style={{ gridColumn: '1 / -1', height: 40, borderRadius: 10, border: 'none', backgroundColor: '#2563eb', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
              Crear Space
            </button>
          </form>

          {!currentSpace.isPersonal && currentSpace.role === 'owner' && (
            <>
              <form action={handleUpdateSpace} style={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: 8, marginBottom: 14 }}>
                <input name="emoji" aria-label="Editar emoji del Space" defaultValue={currentSpace.emoji} maxLength={4} style={inputStyle} />
                <input name="name" aria-label="Editar nombre del Space" defaultValue={currentSpace.name} required style={inputStyle} />
                <button disabled={spaceLoading} style={{ gridColumn: '1 / -1', height: 40, borderRadius: 10, border: '1px solid #334155', backgroundColor: '#0f172a', color: '#bfdbfe', fontWeight: 700, cursor: 'pointer' }}>
                  Guardar nombre y emoji
                </button>
              </form>
              <form action={handleAddMember} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, marginBottom: 14 }}>
                <input name="email" type="email" aria-label="Email del miembro" placeholder="usuario@wallit.app" required style={inputStyle} />
                <button disabled={spaceLoading} style={{ minWidth: 92, borderRadius: 10, border: 'none', backgroundColor: '#22c55e', color: '#052e16', fontWeight: 800, cursor: 'pointer' }}>
                  Agregar
                </button>
              </form>
            </>
          )}

          {currentSpace.isPersonal && (
            <p style={{ fontSize: 13, color: '#a1a1aa', margin: '0 0 12px' }}>El Space Personal no se puede compartir, abandonar ni archivar.</p>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {members.map((member) => (
              <div key={member.userId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: 10, borderRadius: 10, backgroundColor: '#0b1220', border: '1px solid #1e293b' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: '#e5e5e5', fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>{member.email}</div>
                  <div style={{ color: '#94a3b8', fontSize: 12 }}>{member.role === 'owner' ? 'Owner' : 'Member'}</div>
                </div>
                {!currentSpace.isPersonal && currentSpace.role === 'owner' && member.role === 'member' && (
                  <button disabled={spaceLoading} onClick={() => runSpaceAction(() => removeSpaceMember({ spaceId: currentSpace.id, userId: member.userId }))} style={{ border: '1px solid #7f1d1d', backgroundColor: 'transparent', color: '#fca5a5', borderRadius: 8, padding: '7px 10px', cursor: 'pointer' }}>
                    Remover
                  </button>
                )}
              </div>
            ))}
          </div>

          {!currentSpace.isPersonal && currentSpace.role === 'member' && (
            <button disabled={spaceLoading} onClick={() => runSpaceAction(() => leaveSpace(currentSpace.id))} style={{ width: '100%', marginTop: 12, height: 40, borderRadius: 10, border: '1px solid #a16207', backgroundColor: 'transparent', color: '#fde68a', fontWeight: 700, cursor: 'pointer' }}>
              Salir del Space
            </button>
          )}

          {!currentSpace.isPersonal && currentSpace.role === 'owner' && (
            <button disabled={spaceLoading} onClick={() => runSpaceAction(() => archiveSpace(currentSpace.id))} style={{ width: '100%', marginTop: 12, height: 40, borderRadius: 10, border: '1px solid #7f1d1d', backgroundColor: '#1f0a0a', color: '#fca5a5', fontWeight: 700, cursor: 'pointer' }}>
              Archivar Space
            </button>
          )}
        </div>

        {/* Accounts Section */}
        <div style={{
          backgroundColor: '#1a1a2e', borderRadius: 16,
          padding: 16, marginBottom: 20,
          border: '1px solid #2f2f4a',
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
              onClick={() => {
                setNewAccountType('')
                setShowAddAccount(true)
              }}
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
            backgroundColor: '#121225', borderRadius: 12, padding: 14,
            border: '1px solid #3f3f62',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#a1a1aa' }}>Nueva cuenta</span>
              {accounts.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setNewAccountType('')
                    setShowAddAccount(false)
                  }}
                  style={{
                    background: 'none', border: 'none', color: '#a1a1aa',
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

              <select
                name="accountType"
                required
                defaultValue=""
                style={selectStyle}
                onChange={(e) => setNewAccountType(e.target.value)}
              >
                <option value="" disabled>Tipo de cuenta</option>
                {ACCOUNT_TYPES.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>

              <label style={{
                display: 'flex', alignItems: 'center', gap: 8,
                backgroundColor: '#1a1a2e', border: '1px solid #323251',
                borderRadius: 10, padding: '10px 12px', color: '#d4d4d8',
                fontSize: 13, fontWeight: 500, cursor: 'pointer',
              }}>
                <input
                  name="isInvestment"
                  type="checkbox"
                  checked={newAccountIsInvestment}
                  onChange={(e) => setNewAccountIsInvestment(e.target.checked)}
                  style={{ width: 16, height: 16, margin: 0 }}
                />
                Cuenta de inversión
              </label>

              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  name="lastFourDigits"
                  type="text"
                  placeholder={newAccountIsInvestment ? 'Últimos 4 dígitos (opcional)' : 'Últimos 4 dígitos'}
                  required={!newAccountIsInvestment}
                  maxLength={4}
                  pattern="\d{4}"
                  inputMode="numeric"
                  style={{ ...inputStyle, flex: 1 }}
                />
                <select name="currency" defaultValue="CLP" style={{ ...selectStyle, flex: 1 }}>
                  <option value="CLP">CLP</option>
                  <option value="USD">USD</option>
                </select>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  name="initialBalance"
                  type="text"
                  placeholder={newAccountIsInvestment ? 'Valor invertido actual' : 'Saldo inicial'}
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

              {(newAccountType === 'Crédito' || newAccountType === 'credit') && (
                <input
                  name="creditLimit"
                  type="text"
                  inputMode="decimal"
                  placeholder="Cupo total (ej: 2000000)"
                  style={inputStyle}
                />
              )}

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
          {orderedAccounts.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#9ca3af', padding: '16px 0', fontSize: 13 }}>
              Sin cuentas aún
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {orderedAccounts.map((acc) => {
                const balanceData = accountBalances.find(b => b.id === acc.id)
                const balance = balanceData?.balance ?? 0
                const isEditing = editingAccountId === acc.id
                const isEditingInvestment = editingAccountIsInvestment[acc.id] ?? acc.isInvestment
                const currentEditingAccountType = editingAccountType[acc.id] ?? acc.accountType

                if (isEditing) {
                  return (
                    <form key={acc.id} onSubmit={handleAccountUpdate} style={{
                      backgroundColor: '#121225', borderRadius: 12,
                      padding: 12, border: '1px solid #3f3f62',
                    }}>
                      <input type="hidden" name="id" value={acc.id} />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <select name="bankName" required defaultValue={acc.bankName} style={selectStyle}>
                          {BANK_NAMES.map((bank) => (
                            <option key={bank} value={bank}>{bank}</option>
                          ))}
                        </select>
                        <select
                          name="accountType"
                          required
                          defaultValue={acc.accountType}
                          style={selectStyle}
                          onChange={(e) => setEditingAccountType((prev) => ({ ...prev, [acc.id]: e.target.value }))}
                        >
                          {ACCOUNT_TYPES.map((type) => (
                            <option key={type} value={type}>{type}</option>
                          ))}
                        </select>
                        <label style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          backgroundColor: '#1a1a2e', border: '1px solid #323251',
                          borderRadius: 10, padding: '10px 12px', color: '#d4d4d8',
                          fontSize: 13, fontWeight: 500, cursor: 'pointer',
                        }}>
                          <input
                            name="isInvestment"
                            type="checkbox"
                            checked={isEditingInvestment}
                            onChange={(e) => setEditingAccountIsInvestment((prev) => ({ ...prev, [acc.id]: e.target.checked }))}
                            style={{ width: 16, height: 16, margin: 0 }}
                          />
                          Cuenta de inversión
                        </label>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <input
                            name="lastFourDigits"
                            type="text"
                            defaultValue={acc.lastFourDigits}
                            required={!isEditingInvestment}
                            maxLength={4}
                            pattern="\d{4}"
                            inputMode="numeric"
                            placeholder={isEditingInvestment ? 'Últimos 4 dígitos (opcional)' : 'Últimos 4 dígitos'}
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
                            inputMode="decimal" placeholder={isEditingInvestment ? 'Valor invertido actual' : 'Saldo inicial'}
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
                        {(currentEditingAccountType === 'Crédito' || currentEditingAccountType === 'credit') && (
                          <input
                            name="creditLimit"
                            type="text"
                            defaultValue={acc.creditLimit ? (acc.creditLimit / 100).toFixed(0) : ''}
                            inputMode="decimal"
                            placeholder="Cupo total (ej: 2000000)"
                            style={inputStyle}
                          />
                        )}
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
                            onClick={() => {
                              setEditingAccountId(null)
                              setEditingAccountIsInvestment((prev) => {
                                const next = { ...prev }
                                delete next[acc.id]
                                return next
                              })
                              setEditingAccountType((prev) => {
                                const next = { ...prev }
                                delete next[acc.id]
                                return next
                              })
                            }}
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
                  <div
                    key={acc.id}
                    data-testid="settings-account-row"
                    data-account-id={acc.id}
                    data-account-bank={acc.bankName}
                    draggable={!editingAccountId && !reorderingAccounts}
                    onDragStart={(e) => {
                      if (editingAccountId || reorderingAccounts) return
                      setDraggingAccountId(acc.id)
                      e.dataTransfer.effectAllowed = 'move'
                      e.dataTransfer.setData('text/plain', acc.id)
                    }}
                    onDragOver={(e) => {
                      if (!editingAccountId && draggingAccountId && draggingAccountId !== acc.id) {
                        e.preventDefault()
                        e.dataTransfer.dropEffect = 'move'
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault()
                      const draggedId = e.dataTransfer.getData('text/plain') || draggingAccountId
                      setDraggingAccountId(null)
                      if (draggedId) moveAccount(draggedId, acc.id)
                    }}
                    onDragEnd={() => setDraggingAccountId(null)}
                    style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    backgroundColor: '#121225', borderRadius: 12,
                    padding: '12px 14px',
                    border: draggingAccountId === acc.id ? '1px solid #22c55e' : '1px solid #2f2f4a',
                    opacity: deletingAccountId === acc.id ? 0.4 : draggingAccountId === acc.id ? 0.65 : 1,
                    cursor: editingAccountId || reorderingAccounts ? 'default' : 'grab',
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span
                          title="Arrastrar para reordenar"
                          aria-label="Arrastrar para reordenar cuenta"
                          data-testid="account-drag-handle"
                          style={{ color: '#71717a', display: 'inline-flex', cursor: 'grab' }}
                        >
                          <DragHandleIcon />
                        </span>
                        <span style={{ fontSize: 18 }}>{getAccountIcon(acc)}</span>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 600, color: acc.color || '#e5e5e5' }}>
                            {acc.bankName}
                          </div>
                          <div style={{ fontSize: 12, color: '#a1a1aa' }}>
                            {acc.accountType} · ···{acc.lastFourDigits} · {acc.currency}{acc.isInvestment ? ' · Inversión' : ''}
                          </div>
                        </div>
                      </div>
                      <div style={{ marginTop: 6, display: 'flex', gap: 12 }}>
                        <div style={{ fontSize: 12, color: '#9ca3af' }}>
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
                        onClick={() => {
                          setEditingAccountId(acc.id)
                          setEditingAccountIsInvestment((prev) => ({ ...prev, [acc.id]: acc.isInvestment }))
                          setEditingAccountType((prev) => ({ ...prev, [acc.id]: acc.accountType }))
                        }}
                        style={{
                          background: 'none', border: 'none',
                          color: '#a1a1aa', cursor: 'pointer', padding: 6,
                        }}
                      >
                        <EditIcon />
                      </button>
                      <button
                        onClick={() => handleDeleteAccount(acc.id)}
                        disabled={deletingAccountId === acc.id}
                        style={{
                          background: 'none', border: 'none',
                          color: '#9ca3af', cursor: 'pointer', padding: 6,
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

          {localCategories.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#9ca3af', padding: '16px 0', fontSize: 13 }}>
              Sin categorías aún
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {localCategories.map((cat) => {
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
                          color: '#a1a1aa', cursor: 'pointer', padding: 6,
                        }}
                      >
                        <EditIcon />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteCategory(cat.id) }}
                        disabled={deletingCategoryId === cat.id}
                        style={{
                          background: 'none', border: 'none',
                          color: '#9ca3af', cursor: 'pointer', padding: 6,
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
