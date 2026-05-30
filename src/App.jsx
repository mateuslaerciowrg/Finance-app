import React, { useEffect, useMemo, useState } from 'react'
import firebase from './firebase.js'
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth'
import {
	collection,
	addDoc,
	deleteDoc,
	doc,
	query,
	where,
	orderBy,
	onSnapshot,
	Timestamp,
} from 'firebase/firestore'

const colors = [
	'#4caf50',
	'#f44336',
	'#2196f3',
	'#ff9800',
	'#9c27b0',
	'#3f51b5',
	'#00bcd4',
	'#cddc39',
]

function formatCurrency(v) {
	return v.toLocaleString(undefined, { style: 'currency', currency: 'USD' })
}

function PieChart({ data = {}, size = 160 }) {
	const total = Object.values(data).reduce((s, n) => s + n, 0)
	const radius = size / 2
	const stroke = radius * 0.7
	const circumference = 2 * Math.PI * stroke
	let offset = 0

	return (
		<svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
			<g transform={`translate(${radius},${radius})`}>
				{Object.entries(data).map(([k, v], i) => {
					const portion = total === 0 ? 0 : v / total
					const dash = portion * circumference
					const strokeDasharray = `${dash} ${circumference - dash}`
					const strokeDashoffset = -offset
					offset += dash
					return (
						<circle
							key={k}
							r={stroke}
							fill="none"
							stroke={colors[i % colors.length]}
							strokeWidth={radius * 0.6}
							strokeDasharray={strokeDasharray}
							strokeDashoffset={strokeDashoffset}
							style={{ transition: 'stroke-dasharray 300ms, stroke-dashoffset 300ms' }}
						/>
					)
				})}
				<text x="0" y="4" textAnchor="middle" style={{ fontSize: 12 }}>
					{formatCurrency(total)}
				</text>
			</g>
		</svg>
	)
}

function BarChart({ data = {} }) {
	const keys = Object.keys(data)
	const max = Math.max(...Object.values(data), 1)
	return (
		<div style={{ display: 'flex', gap: 8, alignItems: 'end', height: 120 }}>
			{keys.map((k, i) => (
				<div key={k} style={{ textAlign: 'center', flex: 1 }}>
					<div
						title={`${k}: ${data[k]}`}
						style={{
							height: `${(data[k] / max) * 100}%`,
							background: colors[i % colors.length],
							borderRadius: 4,
							transition: 'height 300ms',
						}}
					/>
					<div style={{ fontSize: 12, marginTop: 6 }}>{k}</div>
				</div>
			))}
		</div>
	)
}

function FinancialIndependenceCalculator() {
	const [savings, setSavings] = useState(30000)
	const [monthlySavings, setMonthlySavings] = useState(500)
	const [annualExpenses, setAnnualExpenses] = useState(24000)
	const [annualReturn, setAnnualReturn] = useState(0.05)
	const [withdrawalRate, setWithdrawalRate] = useState(0.04)

	const result = useMemo(() => {
		const target = annualExpenses / withdrawalRate
		const pv = savings
		const pmt = monthlySavings * 12
		const r = annualReturn
		if (pmt <= 0 && pv >= target) return { years: 0, target }

		// numeric solve for years
		let years = 0
		let fv = pv
		while (years < 200 && fv < target) {
			years += 1
			fv = pv * Math.pow(1 + r, years) + (pmt * (Math.pow(1 + r, years) - 1)) / r
		}
		return { years: years === 200 ? Infinity : years, target }
	}, [savings, monthlySavings, annualExpenses, annualReturn, withdrawalRate])

	return (
		<div style={{ border: '1px solid #ddd', padding: 12, borderRadius: 8 }}>
			<h3>Calculadora de Independência Financeira</h3>
			<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
				<label>
					Patrimônio atual
					<input type="number" value={savings} onChange={(e) => setSavings(Number(e.target.value))} />
				</label>
				<label>
					Poupança mensal
					<input type="number" value={monthlySavings} onChange={(e) => setMonthlySavings(Number(e.target.value))} />
				</label>
				<label>
					Despesas anuais
					<input type="number" value={annualExpenses} onChange={(e) => setAnnualExpenses(Number(e.target.value))} />
				</label>
				<label>
					Retorno anual esperado (%)
					<input type="number" step="0.1" value={annualReturn * 100} onChange={(e) => setAnnualReturn(Number(e.target.value) / 100)} />
				</label>
				<label>
					Taxa de retirada segura (%)
					<input type="number" step="0.1" value={withdrawalRate * 100} onChange={(e) => setWithdrawalRate(Number(e.target.value) / 100)} />
				</label>
			</div>
			<div style={{ marginTop: 10 }}>
				<strong>Objetivo de capital:</strong> {formatCurrency(result.target)}
			</div>
			<div>
				<strong>Anos estimados até FI:</strong> {result.years === Infinity ? 'Mais de 200 anos' : `${result.years} anos`}
			</div>
		</div>
	)
}

export default function App() {
	const { auth, provider, db } = firebase
	const [user, setUser] = useState(null)
	const [expenses, setExpenses] = useState([])
	const [amount, setAmount] = useState(0)
	const [category, setCategory] = useState('Other')
	const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
	const [note, setNote] = useState('')
	const [monthOffset, setMonthOffset] = useState(0)

	useEffect(() => {
		const unsub = onAuthStateChanged(auth, (u) => {
			setUser(u)
		})
		return unsub
	}, [auth])

	useEffect(() => {
		if (!user) return
		const q = query(collection(db, 'expenses'), where('uid', '==', user.uid), orderBy('date', 'desc'))
		const unsub = onSnapshot(q, (snap) => {
			const docs = snap.docs.map((d) => {
				const data = d.data()
				return {
					id: d.id,
					amount: data.amount,
					category: data.category,
					note: data.note || '',
					date: data.date && data.date.toDate ? data.date.toDate() : data.date,
				}
			})
			setExpenses(docs)
		})
		return unsub
	}, [user, db])

	function login() {
		signInWithPopup(auth, provider).catch((err) => alert(err.message))
	}

	function logout() {
		signOut(auth).catch((err) => alert(err.message))
	}

	async function addExpense(e) {
		e && e.preventDefault()
		if (!user) return alert('Faça login primeiro')
		const payload = {
			uid: user.uid,
			amount: Number(amount),
			category,
			note,
			date: Timestamp.fromDate(new Date(date)),
			createdAt: Timestamp.now(),
		}
		try {
			await addDoc(collection(db, 'expenses'), payload)
			setAmount(0)
			setNote('')
		} catch (err) {
			alert(err.message)
		}
	}

	async function removeExpense(id) {
		if (!confirm('Remover despesa?')) return
		await deleteDoc(doc(db, 'expenses', id))
	}

	// filter by selected month
	const selected = useMemo(() => {
		const now = new Date()
		const m = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1)
		return { year: m.getFullYear(), month: m.getMonth() }
	}, [monthOffset])

	const filtered = expenses.filter((ex) => ex.date.getFullYear() === selected.year && ex.date.getMonth() === selected.month)

	const byCategory = useMemo(() => {
		const map = {}
		for (const e of filtered) {
			map[e.category] = (map[e.category] || 0) + Number(e.amount)
		}
		return map
	}, [filtered])

	const total = Object.values(byCategory).reduce((s, n) => s + n, 0)

	return (
		<div style={{ fontFamily: 'sans-serif', padding: 20, maxWidth: 980, margin: '0 auto' }}>
			<header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
				<h1>Finance App</h1>
				<div>
					{user ? (
						<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
							<img src={user.photoURL} alt="avatar" style={{ width: 36, height: 36, borderRadius: '50%' }} />
							<span>{user.displayName}</span>
							<button onClick={logout}>Sair</button>
						</div>
					) : (
						<button onClick={login}>Entrar com Google</button>
					)}
				</div>
			</header>

			<main style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 20, marginTop: 20 }}>
				<section>
					<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
						<h2>Despesas</h2>
						<div style={{ display: 'flex', gap: 8 }}>
							<button onClick={() => setMonthOffset((m) => m - 1)}>◀</button>
							<div style={{ padding: '6px 10px', border: '1px solid #eee', borderRadius: 6 }}>
								{new Date(selected.year, selected.month).toLocaleString(undefined, { month: 'long', year: 'numeric' })}
							</div>
							<button onClick={() => setMonthOffset((m) => m + 1)}>▶</button>
						</div>
					</div>

					<form onSubmit={addExpense} style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
						<input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
						<input type="number" step="0.01" placeholder="Valor" value={amount} onChange={(e) => setAmount(e.target.value)} />
						<select value={category} onChange={(e) => setCategory(e.target.value)}>
							<option>Food</option>
							<option>Housing</option>
							<option>Transport</option>
							<option>Health</option>
							<option>Entertainment</option>
							<option>Other</option>
						</select>
						<input placeholder="Nota" value={note} onChange={(e) => setNote(e.target.value)} />
						<button type="submit">Adicionar</button>
					</form>

					<div style={{ marginTop: 16 }}>
						<h3>Lista ({filtered.length}) — Total: {formatCurrency(total)}</h3>
						<ul style={{ listStyle: 'none', padding: 0 }}>
							{filtered.map((e) => (
								<li key={e.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}>
									<div>
										<div style={{ fontWeight: 600 }}>{e.category} — {formatCurrency(Number(e.amount))}</div>
										<div style={{ fontSize: 12, color: '#666' }}>{e.note} • {e.date.toLocaleDateString()}</div>
									</div>
									<div>
										<button onClick={() => removeExpense(e.id)}>Remover</button>
									</div>
								</li>
							))}
						</ul>
					</div>
				</section>

				<aside>
					<div style={{ marginBottom: 12 }}>
						<h3>Dashboard</h3>
						<div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
							<PieChart data={byCategory} />
							<div style={{ flex: 1 }}>
								<BarChart data={byCategory} />
								<div style={{ marginTop: 8 }}>
									{Object.entries(byCategory).map(([k, v], i) => (
										<div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
											<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
												<span style={{ width: 12, height: 12, background: colors[i % colors.length], display: 'inline-block' }} />
												<span>{k}</span>
											</div>
											<div>{formatCurrency(v)}</div>
										</div>
									))}
								</div>
							</div>
						</div>
					</div>

					<div style={{ marginTop: 12 }}>
						<FinancialIndependenceCalculator />
					</div>
				</aside>
			</main>
		</div>
	)
}
