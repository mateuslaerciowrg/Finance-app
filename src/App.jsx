import React, { useState, useEffect } from 'react'
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth'
import { collection, getDocs, setDoc, doc, query, where } from 'firebase/firestore'
import { auth, provider, db } from './firebase'
import './App.css'

const CATEGORIES = ['Food', 'Transport', 'Entertainment', 'Shopping', 'Utilities', 'Health']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function App() {
  const [user, setUser] = useState(null)
  const [expenses, setExpenses] = useState({})
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth())
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear())
  const [activeTab, setActiveTab] = useState('tracker') // 'tracker', 'dashboard', 'calculator'
  const [categoryBudgets, setCategoryBudgets] = useState({})

  // Monitor auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser)
      if (currentUser) {
        loadExpenses(currentUser.uid)
        loadBudgets(currentUser.uid)
      }
    })
    return unsubscribe
  }, [])

  // Load expenses from Firestore
  const loadExpenses = async (uid) => {
    try {
      const q = query(collection(db, 'expenses'), where('userId', '==', uid))
      const snapshot = await getDocs(q)
      const loaded = {}
      snapshot.forEach(doc => {
        const key = doc.data().monthYear
        loaded[key] = doc.data().categories || {}
      })
      setExpenses(loaded)
    } catch (error) {
      console.error('Error loading expenses:', error)
    }
  }

  // Load budgets from Firestore
  const loadBudgets = async (uid) => {
    try {
      const snapshot = await getDocs(collection(db, 'budgets'))
      const budgets = {}
      snapshot.forEach(doc => {
        if (doc.data().userId === uid) {
          Object.assign(budgets, doc.data().categories || {})
        }
      })
      setCategoryBudgets(budgets)
    } catch (error) {
      console.error('Error loading budgets:', error)
    }
  }

  // Save expenses to Firestore
  const saveExpense = async (category, amount) => {
    if (!user) return
    const monthYear = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`
    const newExpenses = { ...expenses }
    if (!newExpenses[monthYear]) newExpenses[monthYear] = {}
    if (!newExpenses[monthYear][category]) newExpenses[monthYear][category] = 0
    newExpenses[monthYear][category] += parseFloat(amount) || 0
    setExpenses(newExpenses)

    try {
      await setDoc(
        doc(db, 'expenses', `${user.uid}-${monthYear}`),
        {
          userId: user.uid,
          monthYear,
          categories: newExpenses[monthYear]
        }
      )
    } catch (error) {
      console.error('Error saving expense:', error)
    }
  }

  // Save budget
  const saveBudget = async (category, budget) => {
    if (!user) return
    const newBudgets = { ...categoryBudgets, [category]: parseFloat(budget) || 0 }
    setCategoryBudgets(newBudgets)

    try {
      await setDoc(
        doc(db, 'budgets', user.uid),
        {
          userId: user.uid,
          categories: newBudgets
        }
      )
    } catch (error) {
      console.error('Error saving budget:', error)
    }
  }

  // Google login
  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, provider)
    } catch (error) {
      console.error('Login error:', error)
    }
  }

  // Logout
  const handleLogout = async () => {
    try {
      await signOut(auth)
    } catch (error) {
      console.error('Logout error:', error)
    }
  }

  const monthYear = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`
  const currentExpenses = expenses[monthYear] || {}
  const totalExpense = Object.values(currentExpenses).reduce((sum, val) => sum + val, 0)

  // Render Login Screen
  if (!user) {
    return (
      <div style={styles.loginContainer}>
        <div style={styles.loginBox}>
          <h1 style={styles.loginTitle}>💰 Finance App</h1>
          <p style={styles.loginSubtitle}>Track your expenses and plan your financial future</p>
          <button style={styles.loginButton} onClick={handleLogin}>
            🔐 Sign in with Google
          </button>
        </div>
      </div>
    )
  }

  // Render Expense Tracker Tab
  const renderTracker = () => (
    <div style={styles.trackerContainer}>
      <div style={styles.monthSidebar}>
        <h3 style={styles.sidebarTitle}>Select Month</h3>
        <div style={styles.monthGrid}>
          {MONTHS.map((month, idx) => (
            <button
              key={month}
              style={{
                ...styles.monthButton,
                ...(idx === currentMonth ? styles.monthButtonActive : {})
              }}
              onClick={() => setCurrentMonth(idx)}
            >
              {month}
            </button>
          ))}
        </div>
        <div style={styles.yearControl}>
          <button onClick={() => setCurrentYear(currentYear - 1)} style={styles.yearBtn}>−</button>
          <span style={styles.yearDisplay}>{currentYear}</span>
          <button onClick={() => setCurrentYear(currentYear + 1)} style={styles.yearBtn}>+</button>
        </div>
      </div>

      <div style={styles.trackerContent}>
        <h2 style={styles.trackerHeader}>{MONTHS[currentMonth]} {currentYear}</h2>
        <div style={styles.totalBox}>
          <span>Total:</span>
          <span style={styles.totalAmount}>${totalExpense.toFixed(2)}</span>
        </div>

        <div style={styles.categoriesGrid}>
          {CATEGORIES.map(category => {
            const amount = currentExpenses[category] || 0
            const budget = categoryBudgets[category] || 0
            const percentage = budget > 0 ? (amount / budget) * 100 : 0

            return (
              <div key={category} style={styles.categoryCard}>
                <h4 style={styles.categoryName}>{category}</h4>
                
                <div style={styles.expenseInputGroup}>
                  <input
                    type="number"
                    placeholder="Add expense"
                    id={`expense-${category}`}
                    style={styles.input}
                  />
                  <button
                    onClick={() => {
                      const input = document.getElementById(`expense-${category}`)
                      saveExpense(category, input.value)
                      input.value = ''
                    }}
                    style={styles.addBtn}
                  >
                    Add
                  </button>
                </div>

                <div style={styles.amountDisplay}>
                  <div>${amount.toFixed(2)}</div>
                  {budget > 0 && <div style={styles.budgetText}>of ${budget.toFixed(2)}</div>}
                </div>

                {budget > 0 && (
                  <div style={styles.progressBar}>
                    <div
                      style={{
                        ...styles.progressFill,
                        width: `${Math.min(percentage, 100)}%`,
                        backgroundColor: percentage > 100 ? '#ff6b6b' : '#22c55e'
                      }}
                    />
                  </div>
                )}

                <div style={styles.budgetInputGroup}>
                  <input
                    type="number"
                    placeholder="Budget"
                    defaultValue={budget || ''}
                    id={`budget-${category}`}
                    style={styles.input}
                  />
                  <button
                    onClick={() => {
                      const input = document.getElementById(`budget-${category}`)
                      saveBudget(category, input.value)
                    }}
                    style={styles.setBudgetBtn}
                  >
                    Set
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )

  // Render Dashboard with Charts
  const renderDashboard = () => {
    const chartData = Object.entries(currentExpenses).map(([cat, amount]) => ({
      name: cat,
      value: amount
    }))

    const maxValue = Math.max(...chartData.map(d => d.value), 1)
    const total = Object.values(currentExpenses).reduce((sum, val) => sum + val, 0)

    return (
      <div style={styles.dashboardContainer}>
        <h2>Dashboard - {MONTHS[currentMonth]} {currentYear}</h2>

        <div style={styles.chartsWrapper}>
          {/* Bar Chart */}
          <div style={styles.chartBox}>
            <h3>Expenses by Category</h3>
            <svg viewBox="0 0 600 300" style={styles.svg}>
              <text x="10" y="20" fontSize="12" fill="#888">Expenses by Category</text>
              {chartData.map((item, idx) => {
                const barHeight = (item.value / maxValue) * 200
                const x = 60 + idx * 85
                const y = 250 - barHeight
                return (
                  <g key={item.name}>
                    <rect
                      x={x}
                      y={y}
                      width="60"
                      height={barHeight}
                      fill="#22c55e"
                      rx="4"
                    />
                    <text
                      x={x + 30}
                      y="270"
                      textAnchor="middle"
                      fontSize="10"
                      fill="#888"
                    >
                      {item.name.slice(0, 3)}
                    </text>
                    <text
                      x={x + 30}
                      y={y - 5}
                      textAnchor="middle"
                      fontSize="9"
                      fill="#22c55e"
                    >
                      ${item.value.toFixed(0)}
                    </text>
                  </g>
                )
              })}
            </svg>
          </div>

          {/* Pie Chart */}
          <div style={styles.chartBox}>
            <h3>Expense Distribution</h3>
            <svg viewBox="0 0 200 200" style={styles.svg}>
              {chartData.reduce((acc, item, idx) => {
                const percentage = total > 0 ? (item.value / total) * 100 : 0
                const startAngle = acc.angle
                const endAngle = startAngle + (percentage * 3.6)
                const start = polarToCartesian(100, 100, 80, endAngle)
                const end = polarToCartesian(100, 100, 80, startAngle)
                const largeArc = percentage > 50 ? 1 : 0

                const path = `
                  M 100 100
                  L ${end.x} ${end.y}
                  A 80 80 0 ${largeArc} 0 ${start.x} ${start.y}
                  Z
                `

                const colors = ['#22c55e', '#4ade80', '#86efac', '#bbf7d0', '#d1fae5', '#ecfdf5']
                acc.paths.push(
                  <path
                    key={item.name}
                    d={path}
                    fill={colors[idx % colors.length]}
                    stroke="#1f2937"
                    strokeWidth="2"
                  />
                )

                return { angle: endAngle, paths: acc.paths }
              }, { angle: 0, paths: [] }).paths}
            </svg>
          </div>
        </div>
      </div>
    )
  }

  // Financial Independence Calculator
  const renderCalculator = () => {
    const [monthlyIncome, setMonthlyIncome] = useState(3000)
    const [savingsRate, setSavingsRate] = useState(30)
    const [currentSavings, setCurrentSavings] = useState(50000)
    const [targetAmount, setTargetAmount] = useState(1000000)

    const monthlySavings = (monthlyIncome * savingsRate) / 100
    const monthsToFI = (targetAmount - currentSavings) / monthlySavings
    const yearsToFI = (monthsToFI / 12).toFixed(1)

    return (
      <div style={styles.calculatorContainer}>
        <h2>Financial Independence Calculator</h2>
        
        <div style={styles.calcInputGroup}>
          <label>Monthly Income: ${monthlyIncome}</label>
          <input
            type="range"
            min="500"
            max="20000"
            value={monthlyIncome}
            onChange={(e) => setMonthlyIncome(Number(e.target.value))}
            style={styles.slider}
          />
        </div>

        <div style={styles.calcInputGroup}>
          <label>Savings Rate: {savingsRate}%</label>
          <input
            type="range"
            min="0"
            max="100"
            value={savingsRate}
            onChange={(e) => setSavingsRate(Number(e.target.value))}
            style={styles.slider}
          />
        </div>

        <div style={styles.calcInputGroup}>
          <label>Current Savings: ${currentSavings}</label>
          <input
            type="number"
            value={currentSavings}
            onChange={(e) => setCurrentSavings(Number(e.target.value))}
            style={styles.calcInput}
          />
        </div>

        <div style={styles.calcInputGroup}>
          <label>FI Target Amount: ${targetAmount}</label>
          <input
            type="number"
            value={targetAmount}
            onChange={(e) => setTargetAmount(Number(e.target.value))}
            style={styles.calcInput}
          />
        </div>

        <div style={styles.calcResults}>
          <div style={styles.resultCard}>
            <div style={styles.resultLabel}>Monthly Savings</div>
            <div style={styles.resultValue}>${monthlySavings.toFixed(2)}</div>
          </div>
          <div style={styles.resultCard}>
            <div style={styles.resultLabel}>Time to FI</div>
            <div style={styles.resultValue}>{yearsToFI} years</div>
          </div>
          <div style={styles.resultCard}>
            <div style={styles.resultLabel}>Remaining Amount</div>
            <div style={styles.resultValue}>${Math.max(0, targetAmount - currentSavings).toFixed(0)}</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.app}>
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <h1 style={styles.title}>💰 Finance App</h1>
        </div>
        <div style={styles.headerCenter}>
          <button
            style={{
              ...styles.tabButton,
              ...(activeTab === 'tracker' ? styles.tabButtonActive : {})
            }}
            onClick={() => setActiveTab('tracker')}
          >
            Tracker
          </button>
          <button
            style={{
              ...styles.tabButton,
              ...(activeTab === 'dashboard' ? styles.tabButtonActive : {})
            }}
            onClick={() => setActiveTab('dashboard')}
          >
            Dashboard
          </button>
          <button
            style={{
              ...styles.tabButton,
              ...(activeTab === 'calculator' ? styles.tabButtonActive : {})
            }}
            onClick={() => setActiveTab('calculator')}
          >
            FI Calculator
          </button>
        </div>
        <div style={styles.headerRight}>
          <span style={styles.userName}>{user?.email}</span>
          <button style={styles.logoutButton} onClick={handleLogout}>
            Logout
          </button>
        </div>
      </header>

      <main style={styles.main}>
        {activeTab === 'tracker' && renderTracker()}
        {activeTab === 'dashboard' && renderDashboard()}
        {activeTab === 'calculator' && renderCalculator()}
      </main>
    </div>
  )
}

// Helper function for pie chart
function polarToCartesian(centerX, centerY, radius, angleInDegrees) {
  const angleInRadians = (angleInDegrees - 90) * Math.PI / 180.0
  return {
    x: centerX + radius * Math.cos(angleInRadians),
    y: centerY + radius * Math.sin(angleInRadians)
  }
}

// Styles
const styles = {
  app: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    backgroundColor: '#0f172a',
    color: '#e2e8f0',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, sans-serif',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    borderBottom: '2px solid #22c55e',
    padding: '1rem 2rem',
    gap: '2rem',
  },
  headerLeft: {
    flex: 0.3,
  },
  headerCenter: {
    display: 'flex',
    gap: '1rem',
    flex: 0.4,
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    flex: 0.3,
    justifyContent: 'flex-end',
  },
  title: {
    margin: 0,
    fontSize: '1.5rem',
    color: '#22c55e',
  },
  tabButton: {
    padding: '0.5rem 1rem',
    backgroundColor: '#334155',
    color: '#cbd5e1',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.9rem',
    transition: 'all 0.3s',
  },
  tabButtonActive: {
    backgroundColor: '#22c55e',
    color: '#0f172a',
    fontWeight: 'bold',
  },
  userName: {
    fontSize: '0.9rem',
    color: '#cbd5e1',
  },
  logoutButton: {
    padding: '0.5rem 1rem',
    backgroundColor: '#ef4444',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.9rem',
  },
  main: {
    flex: 1,
    overflow: 'auto',
    padding: '2rem',
  },
  loginContainer: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    height: '100vh',
    backgroundColor: '#0f172a',
  },
  loginBox: {
    textAlign: 'center',
    padding: '3rem',
    backgroundColor: '#1e293b',
    borderRadius: '12px',
    border: '2px solid #22c55e',
    boxShadow: '0 0 40px rgba(34, 197, 94, 0.2)',
  },
  loginTitle: {
    fontSize: '2.5rem',
    margin: '0 0 1rem 0',
    color: '#22c55e',
  },
  loginSubtitle: {
    fontSize: '1.1rem',
    color: '#cbd5e1',
    marginBottom: '2rem',
  },
  loginButton: {
    padding: '1rem 2rem',
    fontSize: '1.1rem',
    backgroundColor: '#22c55e',
    color: '#0f172a',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontWeight: 'bold',
    transition: 'all 0.3s',
  },
  trackerContainer: {
    display: 'flex',
    gap: '2rem',
  },
  monthSidebar: {
    backgroundColor: '#1e293b',
    borderRadius: '8px',
    padding: '1.5rem',
    minWidth: '200px',
    border: '1px solid #334155',
  },
  sidebarTitle: {
    marginTop: 0,
    marginBottom: '1rem',
    color: '#22c55e',
    textAlign: 'center',
  },
  monthGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '0.5rem',
    marginBottom: '1.5rem',
  },
  monthButton: {
    padding: '0.5rem',
    backgroundColor: '#334155',
    color: '#cbd5e1',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.85rem',
    transition: 'all 0.2s',
  },
  monthButtonActive: {
    backgroundColor: '#22c55e',
    color: '#0f172a',
    fontWeight: 'bold',
  },
  yearControl: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '1rem',
  },
  yearBtn: {
    padding: '0.4rem 0.8rem',
    backgroundColor: '#334155',
    color: '#22c55e',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '1rem',
  },
  yearDisplay: {
    fontSize: '1.2rem',
    fontWeight: 'bold',
    color: '#22c55e',
  },
  trackerContent: {
    flex: 1,
  },
  trackerHeader: {
    margin: 0,
    marginBottom: '1.5rem',
    color: '#22c55e',
    fontSize: '1.8rem',
  },
  totalBox: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '1rem',
    backgroundColor: '#1e293b',
    borderRadius: '8px',
    marginBottom: '2rem',
    border: '2px solid #22c55e',
    fontSize: '1.2rem',
  },
  totalAmount: {
    color: '#22c55e',
    fontWeight: 'bold',
    fontSize: '1.5rem',
  },
  categoriesGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: '1.5rem',
  },
  categoryCard: {
    backgroundColor: '#1e293b',
    borderRadius: '8px',
    padding: '1.5rem',
    border: '1px solid #334155',
    transition: 'all 0.3s',
  },
  categoryName: {
    margin: '0 0 1rem 0',
    color: '#22c55e',
    fontSize: '1.1rem',
  },
  expenseInputGroup: {
    display: 'flex',
    gap: '0.5rem',
    marginBottom: '1rem',
  },
  input: {
    flex: 1,
    padding: '0.5rem',
    backgroundColor: '#0f172a',
    border: '1px solid #334155',
    borderRadius: '4px',
    color: '#e2e8f0',
    fontSize: '0.9rem',
  },
  addBtn: {
    padding: '0.5rem 1rem',
    backgroundColor: '#22c55e',
    color: '#0f172a',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontWeight: 'bold',
  },
  amountDisplay: {
    textAlign: 'center',
    marginBottom: '1rem',
    fontSize: '1.2rem',
    color: '#22c55e',
    fontWeight: 'bold',
  },
  budgetText: {
    fontSize: '0.8rem',
    color: '#cbd5e1',
  },
  progressBar: {
    width: '100%',
    height: '8px',
    backgroundColor: '#0f172a',
    borderRadius: '4px',
    overflow: 'hidden',
    marginBottom: '1rem',
  },
  progressFill: {
    height: '100%',
    transition: 'width 0.3s',
  },
  budgetInputGroup: {
    display: 'flex',
    gap: '0.5rem',
  },
  setBudgetBtn: {
    padding: '0.5rem 0.8rem',
    backgroundColor: '#334155',
    color: '#22c55e',
    border: '1px solid #22c55e',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  dashboardContainer: {
    maxWidth: '1200px',
  },
  chartsWrapper: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))',
    gap: '2rem',
    marginTop: '2rem',
  },
  chartBox: {
    backgroundColor: '#1e293b',
    borderRadius: '8px',
    padding: '1.5rem',
    border: '1px solid #334155',
  },
  svg: {
    width: '100%',
    height: 'auto',
  },
  calculatorContainer: {
    maxWidth: '600px',
  },
  calcInputGroup: {
    marginBottom: '2rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  slider: {
    width: '100%',
    height: '6px',
    borderRadius: '3px',
    backgroundColor: '#334155',
    outline: 'none',
    accentColor: '#22c55e',
  },
  calcInput: {
    padding: '0.5rem',
    backgroundColor: '#0f172a',
    border: '1px solid #334155',
    borderRadius: '4px',
    color: '#e2e8f0',
    fontSize: '1rem',
  },
  calcResults: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '1rem',
    marginTop: '2rem',
  },
  resultCard: {
    backgroundColor: '#1e293b',
    borderRadius: '8px',
    padding: '1.5rem',
    textAlign: 'center',
    border: '2px solid #22c55e',
  },
  resultLabel: {
    color: '#cbd5e1',
    fontSize: '0.9rem',
    marginBottom: '0.5rem',
  },
  resultValue: {
    color: '#22c55e',
    fontSize: '1.8rem',
    fontWeight: 'bold',
  },
}

export default App
