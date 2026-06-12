import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import writeXlsxFile from 'write-excel-file/browser'
import { auth, provider, db } from './firebase'
import {
  signInWithPopup, signOut, onAuthStateChanged,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  updateProfile, sendPasswordResetEmail, GoogleAuthProvider
} from 'firebase/auth'
import { doc, getDoc, setDoc } from 'firebase/firestore'

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const ICON_OPTIONS = ['🛒','👗','💇','🐶','🎓','💻','📱','✈️','🎵','🏋️','💈','🧴','🎁','🏥','📚','🍕','🎪','🧸','⚽','🎯','🛠️','🧹','💡','🌐','🎬','🏠','🧳','💰','🪴','🐱']
const COLOR_OPTIONS = ['#f87171','#fb923c','#fbbf24','#a3e635','#34d399','#22d3ee','#60a5fa','#818cf8','#c084fc','#f472b6','#94a3b8','#e879f9']
const MONTH_NAMES  = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
const FULL_MONTHS  = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']

const CAT_DEFS = [
  { key:'moradia',      label:'Moradia',        icon:'🏠', color:'#4ade80', pct:0.30 },
  { key:'alimentacao',  label:'Alimentação',     icon:'🍽️', color:'#facc15', pct:0.15 },
  { key:'transporte',   label:'Transporte',      icon:'🚗', color:'#60a5fa', pct:0.10 },
  { key:'lazer',        label:'Lazer',           icon:'🎮', color:'#f472b6', pct:0.10 },
  { key:'lanches',      label:'Lanches/Saídas',  icon:'☕', color:'#fb923c', pct:0.05 },
  { key:'saude',        label:'Saúde',           icon:'💊', color:'#a78bfa', pct:0.05 },
  { key:'investimento', label:'Investimentos',   icon:'📈', color:'#34d399', pct:0.20 },
  { key:'reserva',      label:'Reserva Emerg.',  icon:'🛡️', color:'#94a3b8', pct:0.05 },
]

const NOW       = new Date()
const CUR_MONTH = NOW.getMonth()
const CUR_YEAR  = NOW.getFullYear()

const INIT = {
  year: Array.from({length:12},(_,i)=>emptyMonth(i)),
  customCats:[],
  catOverrides:{},
  idade:21,
  metaInv:0,
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

const fmt      = v => v.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})
const fmtShort = v => Math.abs(v)>=1000 ? 'R$'+(v/1000).toFixed(1)+'k' : fmt(v)
const fmtPct   = v => (v*100).toFixed(1)+'%'

function calcMonths(target,monthly,rate){
  if(monthly<=0) return Infinity
  const r=rate/12
  if(r===0) return Math.ceil(target/monthly)
  return Math.ceil(Math.log(1+(target*r)/monthly)/Math.log(1+r))
}
function monthsToStr(m){
  if(!isFinite(m)) return 'nunca'
  const y=Math.floor(m/12),mo=m%12
  if(y===0) return `${mo}m`; if(mo===0) return `${y}a`; return `${y}a ${mo}m`
}
function emptyMonth(idx){
  const cats={}
  CAT_DEFS.forEach(c=>{cats[c.key]=''})
  return { idx, renda:'', cats, cards:[] }
}

// ─── FIRESTORE ────────────────────────────────────────────────────────────────

async function loadFromFirestore(uid){
  try{
    const snap=await getDoc(doc(db,'users',uid))
    if(!snap.exists()) return null
    return snap.data()
  }catch(e){ console.error(e); return null }
}

async function saveToFirestore(uid,data){
  try{ await setDoc(doc(db,'users',uid),data,{merge:true}) }
  catch(e){ console.error(e) }
}

// ─── SVG CHARTS ──────────────────────────────────────────────────────────────

function BarChart({data,height=120,color='#4ade80'}){
  const maxVal=Math.max(...data.map(d=>Math.abs(d.value)),1)
  const w=100/data.length
  return(
    <div>
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{width:'100%',height,display:'block'}}>
        {data.map((d,i)=>{
          const barH=(Math.abs(d.value)/maxVal)*(height-4)
          return(
            <rect key={i} x={i*w+w*0.1} y={height-barH} width={w*0.8} height={barH}
              fill={d.value>=0?color:'#f87171'} rx="2" opacity="0.85"/>
          )
        })}
      </svg>
      <div style={{display:'flex',marginTop:4}}>
        {data.map((d,i)=>(
          <div key={i} style={{flex:1,textAlign:'center',fontSize:9,color:'#64748b',overflow:'hidden',whiteSpace:'nowrap'}}>
            {d.label.slice(0,2)}
          </div>
        ))}
      </div>
    </div>
  )
}

function LineChart({data,height=90,color='#4ade80'}){
  if(data.filter(d=>d.value>0).length<2) return null
  const maxVal=Math.max(...data.map(d=>d.value),1)
  const minVal=Math.min(...data.map(d=>d.value),0)
  const range=maxVal-minVal||1
  const pts=data.map((d,i)=>{
    const x=(i/(data.length-1))*90+5
    const y=height-12-((d.value-minVal)/range)*(height-20)
    return `${x},${y}`
  })
  return(
    <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{width:'100%',height}}>
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round"/>
      {data.map((d,i)=>{
        const x=(i/(data.length-1))*90+5
        const y=height-12-((d.value-minVal)/range)*(height-20)
        return <circle key={i} cx={x} cy={y} r="2" fill={color}/>
      })}
      {data.map((d,i)=>{
        const x=(i/(data.length-1))*90+5
        return <text key={i} x={x} y={height-1} textAnchor="middle" fontSize="5" fill="#64748b">{d.label}</text>
      })}
    </svg>
  )
}

function PieChart({data,size=140}){
  if(!data||data.length===0) return null
  const total=data.reduce((s,d)=>s+d.value,0)
  if(total<=0) return null
  let angle=-Math.PI/2
  const cx=size/2,cy=size/2,r=size/2-8
  const slices=data.map(d=>{
    const sweep=(d.value/total)*Math.PI*2
    const x1=cx+r*Math.cos(angle),y1=cy+r*Math.sin(angle)
    angle+=sweep
    const x2=cx+r*Math.cos(angle),y2=cy+r*Math.sin(angle)
    const large=sweep>Math.PI?1:0
    return{...d,path:`M${cx},${cy} L${x1},${y1} A${r},${r},0,${large},1,${x2},${y2} Z`}
  })
  return(
    <svg viewBox={`0 0 ${size} ${size}`} style={{width:size,height:size}}>
      {slices.map((s,i)=><path key={i} d={s.path} fill={s.color} opacity="0.9"/>)}
      <circle cx={cx} cy={cy} r={r*0.55} fill="#111827"/>
    </svg>
  )
}

// ─── SHARED STYLES ────────────────────────────────────────────────────────────

const S = {
  inp:{background:'#0a0f1e',border:'1px solid #1e293b',color:'#e2e8f0',padding:'9px 13px',borderRadius:9,fontFamily:"'DM Sans',sans-serif",fontSize:14,outline:'none',width:'100%'},
  lbl:{display:'block',fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.8px',color:'#64748b',marginBottom:6},
  btnGreen:{background:'#4ade80',color:'#0a0f1e',border:'none',padding:'9px 16px',borderRadius:9,fontFamily:"'DM Sans',sans-serif",fontSize:14,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap'},
  btnGhost:{background:'#1e293b',color:'#94a3b8',border:'none',padding:'9px 16px',borderRadius:9,fontFamily:"'DM Sans',sans-serif",fontSize:13,cursor:'pointer'},
  th:{background:'#1a2235',padding:'9px 12px',textAlign:'left',fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.6px',color:'#64748b',borderBottom:'1px solid #1e293b'},
  td:{padding:'9px 12px',borderBottom:'1px solid #1e293b',color:'#e2e8f0',fontSize:13},
}

// ─── AUTH SCREEN ──────────────────────────────────────────────────────────────

function AuthScreen({onGoogle}){
  const [mode,setMode]=useState('login') // 'login' | 'cadastro' | 'reset'
  const [resetSent,setResetSent]=useState(false)
  const [nome,setNome]=useState('')
  const [email,setEmail]=useState('')
  const [senha,setSenha]=useState('')
  const [erro,setErro]=useState('')
  const [loading,setLoading]=useState(false)

  const handleReset=async()=>{
    setErro(''); setLoading(true)
    try{
      await sendPasswordResetEmail(auth,email)
      setResetSent(true)
    }catch(e){
      const msgs={'auth/invalid-email':'E-mail inválido.','auth/user-not-found':'E-mail não encontrado.'}
      setErro(msgs[e.code]||'Erro: '+e.message)
    }
    setLoading(false)
  }

  const handleSubmit=async()=>{
    setErro(''); setLoading(true)
    try{
      if(mode==='cadastro'){
        if(!nome.trim()){ setErro('Digite seu nome'); setLoading(false); return }
        const cred=await createUserWithEmailAndPassword(auth,email,senha)
        await updateProfile(cred.user,{displayName:nome.trim()})
      } else {
        await signInWithEmailAndPassword(auth,email,senha)
      }
    }catch(e){
      const msgs={
        'auth/email-already-in-use':'E-mail já cadastrado.',
        'auth/invalid-email':'E-mail inválido.',
        'auth/weak-password':'Senha fraca (mínimo 6 caracteres).',
        'auth/user-not-found':'E-mail não encontrado.',
        'auth/wrong-password':'Senha incorreta.',
        'auth/invalid-credential':'E-mail ou senha incorretos.',
      }
      setErro(msgs[e.code]||'Erro: '+e.message)
    }
    setLoading(false)
  }

  return(
    <div style={{minHeight:'100vh',background:'#0a0f1e',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:24}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:wght@400;500;600&display=swap');*{box-sizing:border-box;margin:0;padding:0;}input:focus{border-color:#4ade80!important;outline:none!important;}`}</style>

      <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:28,color:'#4ade80',marginBottom:6,letterSpacing:'-0.5px'}}>💰 Controle Financeiro</div>
      <div style={{fontSize:13,color:'#64748b',marginBottom:32,textAlign:'center'}}>Seus dados salvos na nuvem, acessíveis em qualquer dispositivo</div>

      <div style={{width:'100%',maxWidth:380,background:'#111827',border:'1px solid #1e293b',borderRadius:16,padding:28}}>

        {/* Tela de reset de senha */}
        {mode==='reset'?(
          <div>
            <button onClick={()=>{setMode('login');setErro('');setResetSent(false)}} style={{background:'none',border:'none',color:'#64748b',cursor:'pointer',fontSize:13,fontFamily:"'DM Sans',sans-serif",marginBottom:20,display:'flex',alignItems:'center',gap:6}}>← Voltar</button>
            <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:18,color:'#e2e8f0',marginBottom:8}}>Recuperar senha</div>
            <div style={{fontSize:13,color:'#64748b',marginBottom:20}}>Digite seu e-mail e enviaremos um link para redefinir sua senha.</div>
            {resetSent?(
              <div style={{background:'#4ade8011',border:'1px solid #4ade8033',borderRadius:8,padding:'12px 14px',fontSize:13,color:'#4ade80',textAlign:'center'}}>
                ✓ E-mail enviado! Verifique sua caixa de entrada.
              </div>
            ):(
              <>
                <div style={{marginBottom:16}}>
                  <label style={S.lbl}>E-mail</label>
                  <input style={S.inp} type="email" placeholder="seu@email.com" value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleReset()}/>
                </div>
                {erro&&<div style={{background:'#f8717118',border:'1px solid #f8717133',borderRadius:8,padding:'8px 12px',fontSize:13,color:'#f87171',marginBottom:16}}>{erro}</div>}
                <button onClick={handleReset} disabled={loading} style={{...S.btnGreen,width:'100%',padding:'12px',fontSize:15,opacity:loading?0.7:1}}>
                  {loading?'Enviando...':'Enviar link de recuperação'}
                </button>
              </>
            )}
          </div>
        ):(
          <>
            {/* Tabs login/cadastro */}
            <div style={{display:'flex',marginBottom:24,background:'#0a0f1e',borderRadius:10,padding:4}}>
              {['login','cadastro'].map(m=>(
                <button key={m} onClick={()=>{setMode(m);setErro('')}} style={{
                  flex:1,padding:'8px',border:'none',borderRadius:8,cursor:'pointer',
                  fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:600,transition:'all 0.15s',
                  background:mode===m?'#4ade80':'transparent',
                  color:mode===m?'#0a0f1e':'#64748b',
                }}>{m==='login'?'Entrar':'Criar conta'}</button>
              ))}
            </div>

            {/* Nome (só cadastro) */}
            {mode==='cadastro'&&(
              <div style={{marginBottom:14}}>
                <label style={S.lbl}>Seu nome</label>
                <input style={S.inp} placeholder="Ex: Mateus" value={nome} onChange={e=>setNome(e.target.value)}/>
              </div>
            )}

            {/* Email */}
            <div style={{marginBottom:14}}>
              <label style={S.lbl}>E-mail</label>
              <input style={S.inp} type="email" placeholder="seu@email.com" value={email} onChange={e=>setEmail(e.target.value)}
                onKeyDown={e=>e.key==='Enter'&&handleSubmit()}/>
            </div>

            {/* Senha */}
            <div style={{marginBottom:mode==='login'?8:20}}>
              <label style={S.lbl}>Senha</label>
              <input style={S.inp} type="password" placeholder="Mínimo 6 caracteres" value={senha} onChange={e=>setSenha(e.target.value)}
                onKeyDown={e=>e.key==='Enter'&&handleSubmit()}/>
            </div>

            {/* Esqueci minha senha (só login) */}
            {mode==='login'&&(
              <div style={{textAlign:'right',marginBottom:20}}>
                <button onClick={()=>{setMode('reset');setErro('')}} style={{background:'none',border:'none',color:'#60a5fa',cursor:'pointer',fontSize:12,fontFamily:"'DM Sans',sans-serif",textDecoration:'underline'}}>
                  Esqueci minha senha
                </button>
              </div>
            )}

            {/* Erro */}
            {erro&&<div style={{background:'#f8717118',border:'1px solid #f8717133',borderRadius:8,padding:'8px 12px',fontSize:13,color:'#f87171',marginBottom:16}}>{erro}</div>}

            {/* Botão principal */}
            <button onClick={handleSubmit} disabled={loading} style={{...S.btnGreen,width:'100%',padding:'12px',fontSize:15,marginBottom:16,opacity:loading?0.7:1}}>
              {loading?'Aguarde...':(mode==='login'?'Entrar':'Criar conta')}
            </button>

            {/* Divisor */}
            <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:16}}>
              <div style={{flex:1,height:1,background:'#1e293b'}}/>
              <span style={{fontSize:12,color:'#475569'}}>ou</span>
              <div style={{flex:1,height:1,background:'#1e293b'}}/>
            </div>

            {/* Google */}
            <button onClick={onGoogle} style={{width:'100%',display:'flex',alignItems:'center',justifyContent:'center',gap:10,background:'#fff',color:'#1a1a1a',border:'none',padding:'11px',borderRadius:9,fontFamily:"'DM Sans',sans-serif",fontSize:14,fontWeight:600,cursor:'pointer'}}>
              <svg width="18" height="18" viewBox="0 0 48 48">
                <path fill="#FFC107" d="M43.6 20H24v8h11.3C33.7 32.6 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.1 6.5 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20c11 0 19.7-8 19.7-20 0-1.3-.1-2.7-.1-4z"/>
                <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.5 15.1 18.9 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.1 6.5 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
                <path fill="#4CAF50" d="M24 44c5.2 0 9.9-1.9 13.5-5l-6.2-5.2C29.4 35.6 26.8 36 24 36c-5.2 0-9.6-3.4-11.2-8L6.1 33.3C9.5 39.6 16.2 44 24 44z"/>
                <path fill="#1976D2" d="M43.6 20H24v8h11.3c-.8 2.2-2.3 4.1-4.2 5.4l6.2 5.2C41.1 35.4 44 30.1 44 24c0-1.3-.1-2.7-.4-4z"/>
              </svg>
              Entrar com Google
            </button>
          </>
        )}
      </div>


    </div>
  )
}

// ─── CAT EDIT PANEL ───────────────────────────────────────────────────────────

function CatEditPanel({cat,onSave,onCancel,onRemove}){
  const [draft,setDraft]=useState({label:cat.label,icon:cat.icon,color:cat.color,pct:String(Math.round(cat.pct*100))})
  const [confirmRemove,setConfirmRemove]=useState(false)
  const save=()=>{
    const pctVal=Math.max(0,Math.min(100,parseFloat(draft.pct)||0))/100
    onSave({label:draft.label||cat.label,icon:draft.icon,color:draft.color,pct:pctVal})
  }
  return(
    <div>
      <div style={{fontSize:11,fontWeight:700,color:'#4ade80',marginBottom:10,textTransform:'uppercase',letterSpacing:'0.7px'}}>Editar categoria</div>
      <div style={{display:'flex',gap:8,marginBottom:10,flexWrap:'wrap'}}>
        <input style={{...S.inp,flex:1,minWidth:120}} placeholder="Nome" value={draft.label} onChange={e=>setDraft(p=>({...p,label:e.target.value}))}/>
        <div style={{display:'flex',alignItems:'center',gap:6}}>
          <input style={{...S.inp,width:58,textAlign:'center'}} type="number" min="0" max="100" value={draft.pct} onChange={e=>setDraft(p=>({...p,pct:e.target.value}))}/>
          <span style={{fontSize:12,color:'#64748b',whiteSpace:'nowrap'}}>% sug.</span>
        </div>
      </div>
      <div style={{marginBottom:10}}>
        <div style={{fontSize:11,color:'#64748b',marginBottom:5}}>Ícone</div>
        <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
          {ICON_OPTIONS.map(ic=>(
            <button key={ic} onClick={()=>setDraft(p=>({...p,icon:ic}))}
              style={{width:30,height:30,borderRadius:6,border:`2px solid ${draft.icon===ic?'#4ade80':'#1e293b'}`,background:draft.icon===ic?'#4ade8022':'#0a0f1e',cursor:'pointer',fontSize:15,display:'flex',alignItems:'center',justifyContent:'center'}}>
              {ic}
            </button>
          ))}
        </div>
      </div>
      <div style={{marginBottom:12}}>
        <div style={{fontSize:11,color:'#64748b',marginBottom:5}}>Cor</div>
        <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
          {COLOR_OPTIONS.map(cl=>(
            <button key={cl} onClick={()=>setDraft(p=>({...p,color:cl}))}
              style={{width:26,height:26,borderRadius:6,border:`2px solid ${draft.color===cl?'#fff':'transparent'}`,background:cl,cursor:'pointer'}}/>
          ))}
        </div>
      </div>
      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
        <button style={{...S.btnGreen,flex:1,padding:'8px 12px',fontSize:13}} onClick={save}>Salvar</button>
        <button style={S.btnGhost} onClick={onCancel}>Cancelar</button>
        {onRemove&&(!confirmRemove?(
          <button onClick={()=>setConfirmRemove(true)} style={{background:'#f8717118',color:'#f87171',border:'1px solid #f8717133',padding:'8px 14px',borderRadius:9,cursor:'pointer',fontFamily:"'DM Sans',sans-serif",fontSize:13}}>Remover</button>
        ):(
          <div style={{display:'flex',gap:6,alignItems:'center'}}>
            <span style={{fontSize:12,color:'#f87171'}}>Confirmar?</span>
            <button onClick={onRemove} style={{background:'#f87171',color:'#0a0f1e',border:'none',padding:'8px 12px',borderRadius:9,cursor:'pointer',fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:700}}>Sim</button>
            <button onClick={()=>setConfirmRemove(false)} style={S.btnGhost}>Não</button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── MONTH CARD ───────────────────────────────────────────────────────────────

function MonthCard({month,onSelect,isActive,allCats}){
  const renda=parseFloat(month.renda)||0
  const totalGasto=allCats.filter(c=>c.key!=='investimento'&&c.key!=='reserva').reduce((s,c)=>s+(parseFloat(month.cats[c.key])||0),0)
  const totalFaturas=month.cards.reduce((s,c)=>s+(parseFloat(c.fatura)||0),0)
  const investido=(parseFloat(month.cats['investimento'])||0)+(parseFloat(month.cats['reserva'])||0)
  const hasData=renda>0
  return(
    <button onClick={onSelect} style={{background:isActive?'#1e293b':'#111827',border:`1px solid ${isActive?'#4ade80':'#1e293b'}`,borderRadius:10,padding:'10px 14px',cursor:'pointer',textAlign:'left',transition:'all 0.15s',minWidth:80,flexShrink:0}}>
      <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:13,color:isActive?'#4ade80':'#e2e8f0',marginBottom:hasData?6:0}}>{MONTH_NAMES[month.idx]}</div>
      {hasData&&(
        <div style={{display:'flex',flexDirection:'column',gap:2}}>
          <div style={{fontSize:10,color:'#60a5fa'}}>{fmtShort(renda)}</div>
          <div style={{fontSize:10,color:'#f87171'}}>{fmtShort(totalGasto+totalFaturas)}</div>
          <div style={{fontSize:10,color:'#4ade80'}}>{fmtShort(investido)}</div>
        </div>
      )}
      {!hasData&&<div style={{fontSize:10,color:'#475569'}}>vazio</div>}
    </button>
  )
}

// ─── MONTH EDITOR ─────────────────────────────────────────────────────────────

function MonthEditor({month,onChange,allCats,customCats,catOps,prevMonth}){
  const renda=parseFloat(month.renda)||0
  const totalCats=allCats.reduce((s,c)=>s+(parseFloat(month.cats[c.key])||0),0)
  const totalFaturas=month.cards.reduce((s,c)=>s+(parseFloat(c.fatura)||0),0)
  const saldo=renda-totalCats-totalFaturas
  const totalPct=allCats.reduce((s,c)=>s+c.pct,0)
  const pctOk=Math.abs(totalPct-1)<0.005

  const setRenda=v=>onChange({...month,renda:v})
  const setCat=(key,val)=>onChange({...month,cats:{...month.cats,[key]:val}})

  const [newCard,setNewCard]=useState({nome:'',limite:'',fatura:'',vencimento:''})
  const addCard=()=>{
    if(!newCard.nome||!newCard.fatura) return
    onChange({...month,cards:[...month.cards,{...newCard,id:Date.now()}]})
    setNewCard({nome:'',limite:'',fatura:'',vencimento:''})
  }
  const removeCard=id=>onChange({...month,cards:month.cards.filter(c=>c.id!==id)})

  const [editingCat,setEditingCat]=useState(null)
  const [showCatForm,setShowCatForm]=useState(false)
  const [newCat,setNewCat]=useState({label:'',icon:'🛒',color:'#f87171',pct:'5'})
  const [confirmDeleteCard,setConfirmDeleteCard]=useState(null)
  const [confirmCopy,setConfirmCopy]=useState(false)

  const prevHasData=prevMonth&&(parseFloat(prevMonth.renda)||0)>0
  const prevMonthName=prevMonth?MONTH_NAMES[prevMonth.idx]:''
  const copyFromPrev=()=>{onChange({...month,renda:prevMonth.renda,cats:{...month.cats,...prevMonth.cats}});setConfirmCopy(false)}

  const despesasMensais=allCats.filter(c=>c.key!=='investimento'&&c.key!=='reserva').reduce((s,c)=>s+(parseFloat(month.cats[c.key])||0),0)
  const metaReserva=despesasMensais*6

  return(
    <div>
      <div style={{marginBottom:20}}>
        <label style={S.lbl}>Renda líquida do mês (R$)</label>
        <input style={S.inp} type="number" placeholder="Ex: 3700" value={month.renda} onChange={e=>setRenda(e.target.value)}/>
        {prevHasData&&(!confirmCopy?(
          <button onClick={()=>renda>0?setConfirmCopy(true):copyFromPrev()} style={{marginTop:8,display:'flex',alignItems:'center',gap:6,background:'transparent',border:'1px dashed #1e293b',color:'#64748b',borderRadius:8,padding:'6px 12px',cursor:'pointer',fontSize:12,fontFamily:"'DM Sans',sans-serif",width:'100%',justifyContent:'center'}}>
            📋 Copiar dados de {prevMonthName}
          </button>
        ):(
          <div style={{marginTop:8,background:'#facc1511',border:'1px solid #facc1533',borderRadius:8,padding:'8px 12px',display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
            <span style={{fontSize:12,color:'#facc15',flex:1}}>Substituir pelo que foi digitado em {prevMonthName}?</span>
            <button onClick={copyFromPrev} style={{...S.btnGreen,fontSize:12,padding:'5px 12px'}}>Sim</button>
            <button onClick={()=>setConfirmCopy(false)} style={{...S.btnGhost,fontSize:12,padding:'5px 12px'}}>Não</button>
          </div>
        ))}
      </div>

      {renda>0&&(
        <div style={{display:'flex',flexDirection:'column',gap:8,marginBottom:20}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',background:saldo>=0?'#4ade8011':'#f8717111',border:`1px solid ${saldo>=0?'#4ade8033':'#f8717133'}`,borderRadius:10,padding:'10px 14px'}}>
            <div>
              <div style={{fontSize:11,color:'#94a3b8',marginBottom:2}}>Saldo restante</div>
              <div style={{fontSize:10,color:'#64748b'}}>renda − categorias − faturas</div>
            </div>
            <span style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:20,color:saldo>=0?'#4ade80':'#f87171'}}>{fmt(saldo)}</span>
          </div>
          {totalFaturas>0&&<div style={{display:'flex',justifyContent:'space-between',fontSize:12,color:'#64748b',padding:'0 4px'}}><span>Faturas incluídas</span><span style={{color:'#facc15',fontWeight:600}}>{fmt(totalFaturas)}</span></div>}
          {!pctOk&&<div style={{background:'#facc1511',border:'1px solid #facc1533',borderRadius:8,padding:'8px 12px',fontSize:12,color:'#facc15'}}>⚠️ Soma das % é {fmtPct(totalPct)} — ajuste para 100%.</div>}
        </div>
      )}

      {renda>0&&despesasMensais>0&&(
        <div style={{background:'#94a3b811',border:'1px solid #94a3b833',borderRadius:10,padding:'12px 14px',marginBottom:20}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
            <span style={{fontSize:13,fontWeight:600,color:'#94a3b8'}}>🛡️ Meta Reserva Emergência</span>
            <span style={{fontSize:12,fontWeight:700,color:'#94a3b8'}}>{fmt(metaReserva)}</span>
          </div>
          <div style={{fontSize:11,color:'#64748b',marginBottom:6}}>6× despesas mensais ({fmt(despesasMensais)})</div>
          <div style={{height:5,background:'#0a0f1e',borderRadius:99,overflow:'hidden'}}>
            <div style={{height:'100%',width:`${Math.min(((parseFloat(month.cats['reserva'])||0)/metaReserva)*100,100)}%`,background:'#94a3b8',borderRadius:99}}/>
          </div>
        </div>
      )}

      <div style={{marginBottom:20}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
          <div style={{fontSize:13,fontWeight:700,color:'#94a3b8',textTransform:'uppercase',letterSpacing:'0.7px'}}>Gastos por categoria</div>
          {!pctOk&&renda>0&&<div style={{fontSize:11,color:'#facc15'}}>{fmtPct(totalPct)} / 100%</div>}
        </div>
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          {allCats.map(c=>{
            const val=parseFloat(month.cats[c.key])||0
            const sug=renda*c.pct
            const pctGasto=renda>0&&val>0?val/renda:0
            const over=renda>0&&c.pct>0&&val>sug
            const barPct=renda>0?Math.min((val/renda)*100,100):0
            const sugBarPct=Math.min(c.pct*100,100)
            const isEditing=editingCat===c.key
            return(
              <div key={c.key} style={{background:'#1a2235',border:`1px solid ${isEditing?'#4ade8055':over?c.color+'44':'#1e293b'}`,borderRadius:12,padding:'12px 14px',transition:'border-color 0.2s'}}>
                {isEditing?(
                  <CatEditPanel cat={c}
                    onSave={patch=>{catOps.update(c.key,patch);setEditingCat(null)}}
                    onCancel={()=>setEditingCat(null)}
                    onRemove={c.key.startsWith('custom_')?()=>{catOps.remove(c.key);setEditingCat(null)}:null}
                  />
                ):(
                  <>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                      <div style={{display:'flex',alignItems:'center',gap:8}}>
                        <span style={{fontSize:18}}>{c.icon}</span>
                        <span style={{fontSize:14,fontWeight:600,color:'#e2e8f0'}}>{c.label}</span>
                      </div>
                      <div style={{display:'flex',alignItems:'center',gap:6}}>
                        {c.pct>0&&<span style={{fontSize:11,fontWeight:700,color:c.color,background:c.color+'18',borderRadius:99,padding:'2px 8px'}}>{fmtPct(c.pct)} sug.</span>}
                        {over&&<span style={{fontSize:10,fontWeight:700,color:'#f87171',background:'#f8717118',borderRadius:99,padding:'2px 6px'}}>acima</span>}
                        <button onClick={()=>setEditingCat(c.key)}
                          style={{background:'none',border:'1px solid #1e293b',color:'#64748b',cursor:'pointer',fontSize:12,borderRadius:6,padding:'2px 7px',fontFamily:"'DM Sans',sans-serif"}}
                          onMouseEnter={e=>{e.currentTarget.style.borderColor='#4ade8066';e.currentTarget.style.color='#4ade80'}}
                          onMouseLeave={e=>{e.currentTarget.style.borderColor='#1e293b';e.currentTarget.style.color='#64748b'}}>✏️</button>
                      </div>
                    </div>
                    <div style={{display:'flex',gap:10,alignItems:'center',marginBottom:8}}>
                      <input style={{...S.inp,flex:1}} type="number"
                        placeholder={renda>0&&c.pct>0?`Sug: ${fmt(sug)}`:'R$ 0,00'}
                        value={month.cats[c.key]} onChange={e=>setCat(c.key,e.target.value)}/>
                      {renda>0&&c.pct>0&&(
                        <div style={{textAlign:'right',minWidth:80,flexShrink:0}}>
                          <div style={{fontSize:11,color:'#64748b'}}>Sugerido</div>
                          <div style={{fontSize:12,fontWeight:700,color:c.color,whiteSpace:'nowrap'}}>{fmtShort(sug)}</div>
                        </div>
                      )}
                    </div>
                    {renda>0&&(
                      <div>
                        <div style={{position:'relative',height:6,background:'#0a0f1e',borderRadius:99,overflow:'hidden',marginBottom:3}}>
                          {c.pct>0&&<div style={{position:'absolute',left:0,top:0,height:'100%',width:`${sugBarPct}%`,background:c.color+'28',borderRadius:99}}/>}
                          <div style={{position:'absolute',left:0,top:0,height:'100%',width:`${barPct}%`,background:over?'#f87171':c.color,borderRadius:99,transition:'width 0.3s'}}/>
                        </div>
                        <div style={{display:'flex',justifyContent:'space-between',flexWrap:'wrap',gap:2}}>
                          <span style={{fontSize:10,color:val>0?(over?'#f87171':c.color):'#475569',whiteSpace:'nowrap'}}>{val>0?`${fmtPct(pctGasto)} da renda`:'não preenchido'}</span>
                          <div style={{display:'flex',gap:6,alignItems:'center'}}>
                            {c.pct>0&&val>0&&<span style={{fontSize:10,color:over?'#f87171':'#475569',whiteSpace:'nowrap'}}>{over?`+${fmtShort(val-sug)} acima`:`${fmtShort(sug-val)} de sobra`}</span>}
                            {(()=>{
                              if(!prevMonth||!prevMonth.cats) return null
                              const pv=parseFloat(prevMonth.cats[c.key])||0
                              if(pv<=0||val<=0) return null
                              const dp=((val-pv)/pv)*100
                              const isInv=c.key==='investimento'||c.key==='reserva'
                              const good=isInv?dp>0:dp<0
                              return <span style={{fontSize:10,color:good?'#4ade80':'#f87171',whiteSpace:'nowrap'}}>{dp>0?'▲':'▼'}{Math.abs(dp).toFixed(0)}% vs {prevMonthName}</span>
                            })()}
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )
          })}
        </div>
        <div style={{marginTop:10}}>
          {!showCatForm?(
            <button onClick={()=>setShowCatForm(true)} style={{display:'flex',alignItems:'center',gap:8,background:'transparent',border:'1px dashed #1e293b',color:'#64748b',borderRadius:10,padding:'10px 16px',cursor:'pointer',fontSize:13,fontFamily:"'DM Sans',sans-serif",width:'100%',justifyContent:'center'}}>
              + Adicionar categoria personalizada
            </button>
          ):(
            <div style={{background:'#1a2235',border:'1px solid #1e293b',borderRadius:12,padding:16}}>
              <div style={{fontSize:12,fontWeight:700,color:'#94a3b8',marginBottom:12,textTransform:'uppercase',letterSpacing:'0.7px'}}>Nova categoria</div>
              <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:12}}>
                <input style={{...S.inp,flex:2,minWidth:130}} placeholder="Nome (ex: Academia)" value={newCat.label} onChange={e=>setNewCat(p=>({...p,label:e.target.value}))}/>
                <div style={{display:'flex',alignItems:'center',gap:6,minWidth:100}}>
                  <input style={{...S.inp,width:58,textAlign:'center'}} type="number" min="0" max="100" placeholder="5" value={newCat.pct} onChange={e=>setNewCat(p=>({...p,pct:e.target.value}))}/>
                  <span style={{fontSize:12,color:'#64748b',whiteSpace:'nowrap'}}>% sug.</span>
                </div>
              </div>
              <div style={{marginBottom:10}}>
                <div style={{fontSize:11,color:'#64748b',marginBottom:5}}>Ícone</div>
                <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
                  {ICON_OPTIONS.map(ic=>(
                    <button key={ic} onClick={()=>setNewCat(p=>({...p,icon:ic}))}
                      style={{width:30,height:30,borderRadius:6,border:`2px solid ${newCat.icon===ic?'#4ade80':'#1e293b'}`,background:newCat.icon===ic?'#4ade8022':'#0a0f1e',cursor:'pointer',fontSize:15,display:'flex',alignItems:'center',justifyContent:'center'}}>
                      {ic}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{marginBottom:12}}>
                <div style={{fontSize:11,color:'#64748b',marginBottom:5}}>Cor</div>
                <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
                  {COLOR_OPTIONS.map(cl=>(
                    <button key={cl} onClick={()=>setNewCat(p=>({...p,color:cl}))}
                      style={{width:26,height:26,borderRadius:6,border:`2px solid ${newCat.color===cl?'#fff':'transparent'}`,background:cl,cursor:'pointer'}}/>
                  ))}
                </div>
              </div>
              <div style={{display:'flex',gap:8}}>
                <button style={{...S.btnGreen,flex:1}} onClick={()=>{catOps.add(newCat);setNewCat({label:'',icon:'🛒',color:'#f87171',pct:'5'});setShowCatForm(false)}}>Criar</button>
                <button style={S.btnGhost} onClick={()=>setShowCatForm(false)}>Cancelar</button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div>
        <div style={{fontSize:13,fontWeight:700,color:'#94a3b8',marginBottom:12,textTransform:'uppercase',letterSpacing:'0.7px'}}>Faturas de Cartão</div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:12}}>
          <input style={{...S.inp,flex:1,minWidth:110}} placeholder="Nome do cartão" value={newCard.nome} onChange={e=>setNewCard(p=>({...p,nome:e.target.value}))}/>
          <input style={{...S.inp,flex:1,minWidth:90}} type="number" placeholder="Fatura (R$)" value={newCard.fatura} onChange={e=>setNewCard(p=>({...p,fatura:e.target.value}))}/>
          <input style={{...S.inp,width:76}} type="number" placeholder="Limite" value={newCard.limite} onChange={e=>setNewCard(p=>({...p,limite:e.target.value}))}/>
          <input style={{...S.inp,width:64}} type="number" placeholder="Venc." value={newCard.vencimento} onChange={e=>setNewCard(p=>({...p,vencimento:e.target.value}))}/>
          <button style={S.btnGreen} onClick={addCard}>+ Add</button>
        </div>
        {month.cards.length>0&&(
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            {month.cards.map(c=>{
              const fatura=parseFloat(c.fatura)||0
              const limite=parseFloat(c.limite)||0
              const uso=limite>0?fatura/limite:0
              const usoColor=uso>0.8?'#f87171':uso>0.5?'#facc15':'#4ade80'
              return(
                <div key={c.id} style={{background:'#111827',border:'1px solid #1e293b',borderRadius:10,padding:12}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
                    <span style={{fontWeight:600,fontSize:13}}>💳 {c.nome}</span>
                    <div style={{display:'flex',gap:10,alignItems:'center'}}>
                      <span style={{fontFamily:"'Syne',sans-serif",fontWeight:700,color:'#60a5fa'}}>{fmt(fatura)}</span>
                      {c.vencimento&&<span style={{fontSize:11,color:'#64748b'}}>dia {c.vencimento}</span>}
                      {confirmDeleteCard===c.id?(
                        <div style={{display:'flex',gap:4,alignItems:'center'}}>
                          <span style={{fontSize:11,color:'#f87171'}}>Remover?</span>
                          <button onClick={()=>removeCard(c.id)} style={{background:'#f87171',color:'#0a0f1e',border:'none',padding:'3px 8px',borderRadius:6,cursor:'pointer',fontSize:12,fontWeight:700,fontFamily:"'DM Sans',sans-serif"}}>Sim</button>
                          <button onClick={()=>setConfirmDeleteCard(null)} style={{background:'#1e293b',color:'#94a3b8',border:'none',padding:'3px 8px',borderRadius:6,cursor:'pointer',fontSize:12,fontFamily:"'DM Sans',sans-serif"}}>Não</button>
                        </div>
                      ):(
                        <button onClick={()=>setConfirmDeleteCard(c.id)} style={{background:'none',border:'none',color:'#64748b',cursor:'pointer',fontSize:18,lineHeight:1}}>×</button>
                      )}
                    </div>
                  </div>
                  {limite>0&&(
                    <div>
                      <div style={{height:5,background:'#1e293b',borderRadius:99,overflow:'hidden',marginBottom:3}}>
                        <div style={{height:'100%',width:`${Math.min(uso*100,100)}%`,background:usoColor,borderRadius:99}}/>
                      </div>
                      <div style={{fontSize:10,color:'#64748b'}}>{fmtPct(uso)} do limite</div>
                    </div>
                  )}
                </div>
              )
            })}
            <div style={{display:'flex',justifyContent:'space-between',padding:'10px 14px',background:'#1a2235',borderRadius:10,border:'1px solid #1e293b'}}>
              <span style={{fontSize:13,fontWeight:600}}>Total faturas (no saldo)</span>
              <span style={{fontFamily:"'Syne',sans-serif",fontWeight:700,color:'#facc15'}}>{fmt(totalFaturas)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── DASHBOARD ───────────────────────────────────────────────────────────────

function Dashboard({year,allCats,metaInv,onSetMetaInv,getDriveToken}){
  const [showExport,setShowExport]=useState(false)
  const [exporting,setExporting]=useState(false)
  const [exportMsg,setExportMsg]=useState('')
  const months=year.filter(m=>parseFloat(m.renda)>0)
  const totals=useMemo(()=>{
    let totalRenda=0,totalGasto=0,totalInvestido=0,totalFaturas=0
    const catTotals={}
    allCats.forEach(c=>{catTotals[c.key]=0})
    year.forEach(m=>{
      totalRenda+=parseFloat(m.renda)||0
      totalFaturas+=m.cards.reduce((s,c)=>s+(parseFloat(c.fatura)||0),0)
      allCats.forEach(c=>{
        const v=parseFloat(m.cats[c.key])||0
        catTotals[c.key]+=v
        if(c.key==='investimento'||c.key==='reserva') totalInvestido+=v
        else totalGasto+=v
      })
    })
    totalGasto+=totalFaturas
    return{totalRenda,totalGasto,totalInvestido,totalFaturas,catTotals}
  },[year,allCats])

  const barGasto=year.map((m,i)=>({label:MONTH_NAMES[i],value:allCats.filter(c=>c.key!=='investimento'&&c.key!=='reserva').reduce((s,c)=>s+(parseFloat(m.cats[c.key])||0),0)+m.cards.reduce((s,c)=>s+(parseFloat(c.fatura)||0),0)}))
  const barInv=year.map((m,i)=>({label:MONTH_NAMES[i],value:(parseFloat(m.cats['investimento'])||0)+(parseFloat(m.cats['reserva'])||0)}))
  const lineRenda=year.map((m,i)=>({label:MONTH_NAMES[i],value:parseFloat(m.renda)||0}))
  const saldoAnual=totals.totalRenda-totals.totalGasto-totals.totalInvestido
  const n=months.length
  const topCat=Object.entries(totals.catTotals).filter(([k])=>k!=='investimento'&&k!=='reserva').sort((a,b)=>b[1]-a[1])[0]
  const topCatDef=topCat?allCats.find(c=>c.key===topCat[0]):null
  const pieData=allCats.filter(c=>c.key!=='investimento'&&c.key!=='reserva'&&totals.catTotals[c.key]>0).map(c=>({label:c.label,value:totals.catTotals[c.key],color:c.color,icon:c.icon}))
  if(totals.totalFaturas>0) pieData.push({label:'Faturas cartão',value:totals.totalFaturas,color:'#facc15',icon:'💳'})

  if(months.length===0) return(
    <div style={{textAlign:'center',padding:'60px 20px',color:'#64748b'}}>
      <div style={{fontSize:40,marginBottom:12}}>📊</div>
      <div style={{fontSize:15,fontWeight:600}}>Nenhum mês preenchido ainda</div>
      <div style={{fontSize:13,marginTop:6}}>Vá em "Meses" e preencha ao menos um mês.</div>
    </div>
  )

  const mediaInv=n>0?totals.totalInvestido/n:0

  const insights=[]
  if(n>=2){
    const bestM=year.reduce((best,m)=>{
      const r=parseFloat(m.renda)||0; if(r<=0) return best
      const g=allCats.filter(c=>c.key!=='investimento'&&c.key!=='reserva').reduce((s,c)=>s+(parseFloat(m.cats[c.key])||0),0)+m.cards.reduce((s,c)=>s+(parseFloat(c.fatura)||0),0)
      const inv=(parseFloat(m.cats['investimento'])||0)+(parseFloat(m.cats['reserva'])||0)
      const sal=r-g-inv
      return(!best||sal>best.sal)?{idx:m.idx,sal}:best
    },null)
    if(bestM) insights.push({icon:'🏆',label:'Melhor mês',value:FULL_MONTHS[bestM.idx],sub:`${fmt(bestM.sal)} de sobra`,color:'#facc15'})
    if(totals.totalInvestido>0) insights.push({icon:'📈',label:'Ritmo de investimento',value:fmtShort(mediaInv)+'/mês',sub:`${fmtShort(totals.totalInvestido)} no ano`,color:'#4ade80'})
    if(topCatDef&&topCat[1]>0) insights.push({icon:topCatDef.icon,label:'Maior categoria',value:topCatDef.label,sub:fmtShort(topCat[1]/n)+'/mês média',color:topCatDef.color})
    if(mediaInv>0){
      const mediaDespM=months.reduce((s,m)=>s+allCats.filter(c=>c.key!=='investimento'&&c.key!=='reserva').reduce((ss,c)=>ss+(parseFloat(m.cats[c.key])||0),0)+m.cards.reduce((ss,c)=>ss+(parseFloat(c.fatura)||0),0),0)/n
      const alvoFI=mediaDespM*12/0.04
      const mesesFI=calcMonths(alvoFI,mediaInv,0.06)
      if(isFinite(mesesFI)) insights.push({icon:'🎯',label:'Projeção independência',value:monthsToStr(mesesFI),sub:'a 6% real ao ano',color:'#60a5fa'})
    }
  }

  const buildExcelRows=()=>{
    const HS={backgroundColor:'#1a2235',color:'#e2e8f0',fontWeight:'bold',align:'center'}
    const headers=[
      {value:'Mês',...HS},
      {value:'Renda',...HS},
      ...allCats.map(c=>({value:c.label,...HS})),
      {value:'Faturas',...HS},
      {value:'Total Gasto',...HS},
      {value:'Investido',...HS},
      {value:'Saldo',...HS},
    ]
    const dm=year.filter(m=>parseFloat(m.renda)>0)
    const rows=dm.map((m,idx)=>{
      const r=parseFloat(m.renda)||0
      const cats=allCats.map(c=>parseFloat(m.cats[c.key])||0)
      const fat=m.cards.reduce((s,c)=>s+(parseFloat(c.fatura)||0),0)
      const gasto=cats.filter((_,i)=>allCats[i].key!=='investimento'&&allCats[i].key!=='reserva').reduce((s,v)=>s+v,0)+fat
      const inv=cats.filter((_,i)=>allCats[i].key==='investimento'||allCats[i].key==='reserva').reduce((s,v)=>s+v,0)
      const saldo=r-gasto-inv
      const bg=idx%2===0?'#111827':'#0a0f1e'
      return[
        {value:FULL_MONTHS[m.idx],type:String,backgroundColor:bg,fontWeight:'bold'},
        {value:r,type:Number,format:'"R$"#,##0.00',backgroundColor:bg,color:'#93c5fd',fontWeight:'bold'},
        ...cats.map((v,i)=>({value:v,type:Number,format:'"R$"#,##0.00',backgroundColor:bg,color:allCats[i].key==='investimento'||allCats[i].key==='reserva'?'#6ee7b7':'#cbd5e1'})),
        {value:fat,type:Number,format:'"R$"#,##0.00',backgroundColor:bg,color:'#fde68a'},
        {value:gasto,type:Number,format:'"R$"#,##0.00',backgroundColor:bg,color:'#fca5a5',fontWeight:'bold'},
        {value:inv,type:Number,format:'"R$"#,##0.00',backgroundColor:bg,color:'#6ee7b7',fontWeight:'bold'},
        {value:saldo,type:Number,format:'"R$"#,##0.00',backgroundColor:bg,color:saldo>=0?'#4ade80':'#f87171',fontWeight:'bold'},
      ]
    })
    if(dm.length>0){
      const tc=allCats.map(c=>dm.reduce((s,m)=>s+(parseFloat(m.cats[c.key])||0),0))
      const tf=dm.reduce((s,m)=>s+m.cards.reduce((ss,c)=>ss+(parseFloat(c.fatura)||0),0),0)
      const tg=tc.filter((_,i)=>allCats[i].key!=='investimento'&&allCats[i].key!=='reserva').reduce((s,v)=>s+v,0)+tf
      const ti=tc.filter((_,i)=>allCats[i].key==='investimento'||allCats[i].key==='reserva').reduce((s,v)=>s+v,0)
      const tr=dm.reduce((s,m)=>s+(parseFloat(m.renda)||0),0)
      const ts=tr-tg-ti
      const TS={backgroundColor:'#1e293b',fontWeight:'bold',align:'center'}
      rows.push([
        {value:'TOTAL',type:String,...TS,color:'#e2e8f0'},
        {value:tr,type:Number,format:'"R$"#,##0.00',...TS,color:'#93c5fd'},
        ...tc.map((v,i)=>({value:v,type:Number,format:'"R$"#,##0.00',...TS,color:allCats[i].key==='investimento'||allCats[i].key==='reserva'?'#6ee7b7':'#cbd5e1'})),
        {value:tf,type:Number,format:'"R$"#,##0.00',...TS,color:'#fde68a'},
        {value:tg,type:Number,format:'"R$"#,##0.00',...TS,color:'#fca5a5'},
        {value:ti,type:Number,format:'"R$"#,##0.00',...TS,color:'#6ee7b7'},
        {value:ts,type:Number,format:'"R$"#,##0.00',...TS,color:ts>=0?'#4ade80':'#f87171'},
      ])
    }
    return{data:[headers,...rows],columns:[{width:15},{width:14},...allCats.map(()=>({width:14})),{width:15},{width:14},{width:14},{width:14}]}
  }

  const handleDownloadExcel=async()=>{
    setExporting(true);setExportMsg('')
    try{
      const {data,columns}=buildExcelRows()
      await writeXlsxFile(data,{columns,stickyRowsCount:1}).toFile(`controle-financeiro-${CUR_YEAR}.xlsx`)
      setExportMsg('ok:Arquivo baixado!')
    }catch(e){console.error(e);setExportMsg('err:'+(e?.message||String(e)))}
    setExporting(false)
  }

  const handleGoogleDrive=async()=>{
    setExporting(true);setExportMsg('')
    try{
      const {data,columns}=buildExcelRows()
      const blob=await writeXlsxFile(data,{columns,stickyRowsCount:1}).toBlob()
      const token=await getDriveToken()
      if(!token) throw new Error('Não foi possível autenticar com o Google')
      const fileName=`controle-financeiro-${CUR_YEAR}.xlsx`
      const meta={name:fileName,mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}
      const form=new FormData()
      form.append('metadata',new Blob([JSON.stringify(meta)],{type:'application/json'}))
      form.append('file',blob)
      const res=await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',{
        method:'POST',headers:{Authorization:`Bearer ${token}`},body:form
      })
      if(!res.ok){
        const err=await res.json().catch(()=>({}))
        throw new Error(res.status===403?'Ative a Google Drive API no Google Cloud Console':(err?.error?.message||`Erro ${res.status}`))
      }
      setExportMsg('ok:Salvo no Google Drive!')
    }catch(e){console.error(e);setExportMsg('err:'+(e?.message||String(e)))}
    setExporting(false)
  }

  const handleShare=async()=>{
    setExporting(true);setExportMsg('')
    try{
      const {data,columns}=buildExcelRows()
      const blob=await writeXlsxFile(data,{columns,stickyRowsCount:1}).toBlob()
      const fileName=`controle-financeiro-${CUR_YEAR}.xlsx`
      const file=new File([blob],fileName,{type:blob.type})
      if(navigator.canShare&&navigator.canShare({files:[file]})){
        await navigator.share({files:[file],title:'Controle Financeiro'})
        setExportMsg('ok:Compartilhado!')
      }else{
        const url=URL.createObjectURL(blob)
        const a=document.createElement('a');a.href=url;a.download=fileName;a.click()
        URL.revokeObjectURL(url)
        setExportMsg('ok:Arquivo baixado!')
      }
    }catch(e){console.error(e);if(e.name!=='AbortError') setExportMsg('err:'+(e?.message||String(e)))}
    setExporting(false)
  }

  return(
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
        <div style={{fontSize:11,fontWeight:700,color:'#64748b',textTransform:'uppercase',letterSpacing:'0.7px'}}>Resumo do ano {CUR_YEAR}</div>
        <button onClick={()=>{setShowExport(true);setExportMsg('')}} style={{...S.btnGhost,fontSize:12,padding:'6px 12px'}}>⬇ Exportar</button>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))',gap:12,marginBottom:insights.length?12:20}}>
        {[{label:'Renda total',val:totals.totalRenda,color:'#60a5fa',icon:'💰'},{label:'Total gasto',val:totals.totalGasto,color:'#f87171',icon:'💸'},{label:'Total investido',val:totals.totalInvestido,color:'#4ade80',icon:'📈'},{label:'Saldo líquido',val:saldoAnual,color:saldoAnual>=0?'#facc15':'#f87171',icon:'🧾'}].map((k,i)=>(
          <div key={i} style={{background:'#111827',border:'1px solid #1e293b',borderRadius:14,padding:16}}>
            <div style={{fontSize:18,marginBottom:6}}>{k.icon}</div>
            <div style={{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.7px',color:'#64748b',marginBottom:6}}>{k.label}</div>
            <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:16,color:k.color,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{fmtShort(k.val)}</div>
          </div>
        ))}
      </div>
      {insights.length>0&&(
        <div style={{display:'flex',gap:10,overflowX:'auto',marginBottom:16,paddingBottom:2}}>
          {insights.map((ins,i)=>(
            <div key={i} style={{background:'#111827',border:'1px solid #1e293b',borderRadius:12,padding:'12px 14px',minWidth:158,flexShrink:0}}>
              <div style={{fontSize:20,marginBottom:4}}>{ins.icon}</div>
              <div style={{fontSize:9,fontWeight:700,color:'#64748b',textTransform:'uppercase',letterSpacing:'0.6px',marginBottom:4}}>{ins.label}</div>
              <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:14,color:ins.color,marginBottom:2}}>{ins.value}</div>
              <div style={{fontSize:10,color:'#475569'}}>{ins.sub}</div>
            </div>
          ))}
        </div>
      )}
      {n>=2&&(
        <div style={{background:'#111827',border:'1px solid #1e293b',borderRadius:14,padding:16,marginBottom:16}}>
          <div style={{fontSize:12,fontWeight:700,color:'#94a3b8',marginBottom:12,textTransform:'uppercase',letterSpacing:'0.7px'}}>Média mensal ({n} meses)</div>
          <div style={{display:'flex',gap:20,flexWrap:'wrap'}}>
            {[{label:'Renda',val:totals.totalRenda/n,color:'#60a5fa'},{label:'Gasto',val:totals.totalGasto/n,color:'#f87171'},{label:'Investido',val:totals.totalInvestido/n,color:'#4ade80'}].map((k,i)=>(
              <div key={i}><div style={{fontSize:11,color:'#64748b'}}>{k.label}</div><div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,color:k.color}}>{fmt(k.val)}</div></div>
            ))}
            {topCatDef&&<div><div style={{fontSize:11,color:'#64748b'}}>Maior gasto</div><div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,color:topCatDef.color}}>{topCatDef.icon} {topCatDef.label}</div></div>}
          </div>
        </div>
      )}
      <div style={{background:'#111827',border:'1px solid #1e293b',borderRadius:14,padding:16,marginBottom:16}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
          <div style={{fontSize:12,fontWeight:700,color:'#4ade80',textTransform:'uppercase',letterSpacing:'0.7px'}}>🎯 Meta de investimento/mês</div>
          <input type="number" value={metaInv||''} onChange={e=>onSetMetaInv(parseFloat(e.target.value)||0)} placeholder="Ex: 500" style={{...S.inp,width:110,textAlign:'right',padding:'6px 10px',fontSize:13}}/>
        </div>
        {metaInv>0&&n>0?(
          <>
            <div style={{height:6,background:'#0a0f1e',borderRadius:99,overflow:'hidden',marginBottom:6}}>
              <div style={{height:'100%',width:`${Math.min((mediaInv/metaInv)*100,100)}%`,background:mediaInv>=metaInv?'#4ade80':'#60a5fa',borderRadius:99,transition:'width 0.3s'}}/>
            </div>
            <div style={{fontSize:11,color:'#64748b'}}>
              {fmtShort(mediaInv)}/mês de média — <span style={{color:mediaInv>=metaInv?'#4ade80':'#facc15',fontWeight:600}}>{Math.round((mediaInv/metaInv)*100)}%</span> da meta de {fmtShort(metaInv)}
            </div>
          </>
        ):(
          <div style={{fontSize:11,color:'#475569'}}>Defina uma meta para acompanhar seu progresso mensal de investimento.</div>
        )}
      </div>
      <div className="chart-grid" style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
        <div style={{background:'#111827',border:'1px solid #1e293b',borderRadius:14,padding:14}}>
          <div style={{fontSize:11,fontWeight:700,color:'#f87171',marginBottom:8,textTransform:'uppercase',letterSpacing:'0.6px'}}>💸 Gastos/mês</div>
          <BarChart data={barGasto} color="#f87171"/>
        </div>
        <div style={{background:'#111827',border:'1px solid #1e293b',borderRadius:14,padding:14}}>
          <div style={{fontSize:11,fontWeight:700,color:'#4ade80',marginBottom:8,textTransform:'uppercase',letterSpacing:'0.6px'}}>📈 Investido/mês</div>
          <BarChart data={barInv} color="#4ade80"/>
        </div>
      </div>
      <div style={{background:'#111827',border:'1px solid #1e293b',borderRadius:14,padding:14,marginBottom:12}}>
        <div style={{fontSize:11,fontWeight:700,color:'#60a5fa',marginBottom:8,textTransform:'uppercase',letterSpacing:'0.6px'}}>💰 Evolução da renda</div>
        <LineChart data={lineRenda} color="#60a5fa"/>
      </div>
      {pieData.length>0&&(
        <div style={{background:'#111827',border:'1px solid #1e293b',borderRadius:14,padding:16}}>
          <div style={{fontSize:12,fontWeight:700,color:'#94a3b8',marginBottom:14,textTransform:'uppercase',letterSpacing:'0.7px'}}>Onde o dinheiro foi (ano)</div>
          <div style={{display:'flex',gap:16,flexWrap:'wrap',alignItems:'center',marginBottom:16}}>
            <PieChart data={pieData}/>
            <div style={{flex:1,minWidth:140}}>
              {pieData.map((d,i)=>(
                <div key={i} style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
                  <div style={{width:10,height:10,borderRadius:99,background:d.color,flexShrink:0}}/>
                  <span style={{fontSize:12,color:'#94a3b8',flex:1}}>{d.icon} {d.label}</span>
                  <span style={{fontSize:12,fontWeight:700,color:d.color}}>{fmt(d.value)}</span>
                </div>
              ))}
            </div>
          </div>
          {allCats.map(c=>{
            const val=totals.catTotals[c.key]
            const pct=totals.totalRenda>0?val/totals.totalRenda:0
            return(
              <div key={c.key} style={{marginBottom:8}}>
                <div style={{display:'flex',justifyContent:'space-between',marginBottom:2}}>
                  <span style={{fontSize:12,color:'#94a3b8'}}>{c.icon} {c.label}</span>
                  <div style={{display:'flex',gap:10}}><span style={{fontSize:12,fontWeight:600,color:c.color}}>{fmt(val)}</span><span style={{fontSize:11,color:'#64748b'}}>{fmtPct(pct)}</span></div>
                </div>
                <div style={{height:4,background:'#1e293b',borderRadius:99,overflow:'hidden'}}>
                  <div style={{height:'100%',width:`${Math.min(pct*100*3,100)}%`,background:c.color,borderRadius:99}}/>
                </div>
              </div>
            )
          })}
        </div>
      )}
      {showExport&&(
        <>
          <div onClick={()=>{setShowExport(false);setExportMsg('')}} style={{position:'fixed',inset:0,background:'#00000070',zIndex:100}}/>
          <div style={{position:'fixed',top:'50%',left:'50%',transform:'translate(-50%,-50%)',background:'#111827',border:'1px solid #1e293b',borderRadius:20,padding:24,zIndex:101,width:'min(360px,92vw)',boxShadow:'0 20px 60px #00000080'}}>
            <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:17,color:'#e2e8f0',marginBottom:4}}>Exportar dados</div>
            <div style={{fontSize:12,color:'#475569',marginBottom:20}}>Escolha o formato e destino</div>
            <div style={{display:'flex',flexDirection:'column',gap:10}}>
              {[
                {icon:'📊',title:'Baixar Excel (.xlsx)',desc:'Tabela formatada com cores e totais',fn:handleDownloadExcel},
                {icon:'☁️',title:'Salvar no Google Drive',desc:'Envia direto para o seu Drive Google',fn:handleGoogleDrive},
                {icon:'📁',title:'Compartilhar / iCloud Drive',desc:'Abre o compartilhador do sistema',fn:handleShare},
              ].map(opt=>(
                <button key={opt.title} onClick={opt.fn} disabled={exporting} style={{width:'100%',textAlign:'left',background:'#0a0f1e',border:'1px solid #1e293b',borderRadius:12,padding:'14px 16px',cursor:exporting?'not-allowed':'pointer',display:'flex',alignItems:'center',gap:14,opacity:exporting?0.5:1,fontFamily:"'DM Sans',sans-serif",transition:'border-color 0.15s'}}>
                  <span style={{fontSize:26,lineHeight:1}}>{opt.icon}</span>
                  <div>
                    <div style={{fontSize:13,fontWeight:600,color:'#e2e8f0'}}>{opt.title}</div>
                    <div style={{fontSize:11,color:'#475569',marginTop:2}}>{opt.desc}</div>
                  </div>
                </button>
              ))}
            </div>
            {exporting&&<div style={{textAlign:'center',fontSize:12,color:'#60a5fa',marginTop:14}}>⏳ Gerando arquivo...</div>}
            {exportMsg.startsWith('ok:')&&<div style={{textAlign:'center',fontSize:12,color:'#4ade80',marginTop:14}}>✓ {exportMsg.slice(3)}</div>}
            {exportMsg.startsWith('err:')&&<div style={{textAlign:'center',fontSize:12,color:'#f87171',marginTop:14,lineHeight:1.6}}>⚠️ {exportMsg.slice(4)}</div>}
            <button onClick={()=>{setShowExport(false);setExportMsg('')}} style={{width:'100%',marginTop:16,padding:'10px',background:'transparent',border:'1px solid #1e293b',borderRadius:10,color:'#64748b',cursor:'pointer',fontFamily:"'DM Sans',sans-serif",fontSize:13}}>Fechar</button>
          </div>
        </>
      )}
    </div>
  )
}

// ─── INDEPENDENCE ─────────────────────────────────────────────────────────────

function Independence({year,allCats,idade,onSetIdade}){
  const filled=year.filter(m=>parseFloat(m.renda)>0)
  const n=filled.length
  if(n===0) return(
    <div style={{textAlign:'center',padding:'60px 20px',color:'#64748b'}}>
      <div style={{fontSize:40,marginBottom:12}}>🎯</div>
      <div style={{fontSize:15,fontWeight:600}}>Preencha ao menos um mês para calcular</div>
    </div>
  )
  const mediaRenda=filled.reduce((s,m)=>s+(parseFloat(m.renda)||0),0)/n
  const mediaDespesas=filled.reduce((s,m)=>s+allCats.filter(c=>c.key!=='investimento'&&c.key!=='reserva').reduce((ss,c)=>ss+(parseFloat(m.cats[c.key])||0),0)+m.cards.reduce((ss,c)=>ss+(parseFloat(c.fatura)||0),0),0)/n
  const mediaInv=filled.reduce((s,m)=>s+(parseFloat(m.cats['investimento'])||0)+(parseFloat(m.cats['reserva'])||0),0)/n
  const alvo4=mediaDespesas*12/0.04
  const cenarios=[{label:'3% real',rate:0.03},{label:'6% real',rate:0.06},{label:'8% real',rate:0.08}]
  const poupancas=mediaInv>0?[mediaInv,mediaInv+300,mediaInv+700,mediaInv+1200]:[500,900,1300,1800]
  return(
    <div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))',gap:12,marginBottom:20}}>
        {[{label:'Alvo (4%)',val:alvo4,color:'#4ade80'},{label:'Você investe/mês',val:mediaInv,color:'#60a5fa'},{label:'Despesas médias/mês',val:mediaDespesas,color:'#f87171'}].map((k,i)=>(
          <div key={i} style={{background:'#111827',border:'1px solid #1e293b',borderRadius:14,padding:16}}>
            <div style={{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.7px',color:'#64748b',marginBottom:8}}>{k.label}</div>
            <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:15,color:k.color,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{fmtShort(k.val)}</div>
          </div>
        ))}
      </div>
      <div style={{display:'flex',alignItems:'center',gap:10,background:'#111827',border:'1px solid #1e293b',borderRadius:10,padding:'10px 14px',marginBottom:16}}>
        <span style={{fontSize:13,color:'#94a3b8',flex:1}}>Sua idade atual</span>
        <input type="number" value={idade} onChange={e=>onSetIdade(parseInt(e.target.value)||0)} style={{...S.inp,width:72,textAlign:'center'}}/>
      </div>
      <div style={{background:'#111827',border:'1px solid #1e293b',borderRadius:14,padding:16,marginBottom:16}}>
        <div style={{fontSize:12,fontWeight:700,color:'#94a3b8',marginBottom:14,textTransform:'uppercase',letterSpacing:'0.7px'}}>Prazo para independência</div>
        <div style={{overflowX:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
            <thead><tr><th style={S.th}>Investimento/mês</th>{cenarios.map(c=><th key={c.rate} style={S.th}>{c.label}</th>)}</tr></thead>
            <tbody>
              {poupancas.map((p,i)=>(
                <tr key={i}>
                  <td style={{...S.td,color:'#60a5fa',fontWeight:700}}>{fmt(p)}</td>
                  {cenarios.map(c=>{
                    const m=calcMonths(alvo4,p,c.rate)
                    const anos=isFinite(m)?Math.floor(m/12):null
                    return<td key={c.rate} style={S.td}>{monthsToStr(m)}{anos&&<span style={{fontSize:10,color:'#64748b',marginLeft:4}}>({idade+anos}a)</span>}</td>
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div style={{background:'#4ade8011',border:'1px solid #4ade8033',borderRadius:14,padding:16,fontSize:13,lineHeight:1.7,color:'#94a3b8'}}>
        <strong style={{color:'#4ade80'}}>Atenção:</strong> cálculos baseados nos seus gastos atuais. Reavalie a cada 12 meses.
      </div>
    </div>
  )
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────

export default function App(){
  const [user,setUser]=useState(undefined)
  const [syncStatus,setSyncStatus]=useState('')
  const [state,setStateRaw]=useState(INIT)
  const saveTimer=useState(null)

  useEffect(()=>{
    const unsub=onAuthStateChanged(auth,async u=>{
      setUser(u)
      if(u){
        const data=await loadFromFirestore(u.uid)
        if(data){
          const year=Array.from({length:12},(_,i)=>{
            const m=data.year?.[i]||emptyMonth(i)
            const allKeys=[...CAT_DEFS,...(data.customCats||[])].map(c=>c.key)
            allKeys.forEach(k=>{if(!(k in m.cats)) m.cats[k]=''})
            return m
          })
          setStateRaw({...INIT,...data,year})
        }
      }
    })
    return unsub
  },[])

  const setState=useCallback(updater=>{
    setStateRaw(prev=>{
      const next=typeof updater==='function'?updater(prev):updater
      if(user){
        setSyncStatus('salvando')
        if(saveTimer[0]) clearTimeout(saveTimer[0])
        saveTimer[0]=setTimeout(async()=>{
          try{ await saveToFirestore(user.uid,next); setSyncStatus('salvo'); setTimeout(()=>setSyncStatus(''),2000) }
          catch{ setSyncStatus('erro') }
        },1500)
      }
      return next
    })
  },[user])

  const {year,customCats,catOverrides,idade,metaInv}=state

  const allCats=useMemo(()=>
    [...CAT_DEFS,...customCats].map(c=>catOverrides[c.key]?{...c,...catOverrides[c.key]}:c),
    [customCats,catOverrides]
  )

  const catOps={
    add:(newCat)=>{
      const key='custom_'+Date.now()
      const pctVal=Math.max(0,Math.min(100,parseFloat(newCat.pct)||0))/100
      const cat={key,label:newCat.label.trim(),icon:newCat.icon,color:newCat.color,pct:pctVal}
      setState(prev=>({...prev,customCats:[...prev.customCats,cat],year:prev.year.map(m=>({...m,cats:{...m.cats,[key]:''}})) }))
    },
    remove:(key)=>{
      setState(prev=>({...prev,customCats:prev.customCats.filter(c=>c.key!==key),year:prev.year.map(m=>{const cats={...m.cats};delete cats[key];return{...m,cats}})}))
    },
    update:(key,patch)=>{
      setState(prev=>({...prev,catOverrides:{...prev.catOverrides,[key]:{...(prev.catOverrides[key]||{}),...patch}}}))
    },
  }

  const updateMonth=(idx,data)=>setState(prev=>({...prev,year:prev.year.map((m,i)=>i===idx?data:m)}))

  const [activeTab,setActiveTab]=useState('dashboard')
  const [selectedMonth,setSelectedMonth]=useState(CUR_MONTH)
  const [menuOpen,setMenuOpen]=useState(false)
  const driveTokenRef=useRef({token:null,expiry:0})
  const getDriveToken=useCallback(async()=>{
    if(driveTokenRef.current.token&&Date.now()<driveTokenRef.current.expiry-60000) return driveTokenRef.current.token
    try{
      const dp=new GoogleAuthProvider()
      dp.addScope('https://www.googleapis.com/auth/drive.file')
      const result=await signInWithPopup(auth,dp)
      const cred=GoogleAuthProvider.credentialFromResult(result)
      const token=cred?.accessToken
      if(token) driveTokenRef.current={token,expiry:Date.now()+3600000}
      return token
    }catch(e){console.error(e);return null}
  },[])

  if(user===undefined) return(
    <div style={{minHeight:'100vh',background:'#0a0f1e',display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div style={{fontFamily:"'Syne',sans-serif",color:'#4ade80',fontSize:18}}>Carregando...</div>
    </div>
  )

  if(!user) return <AuthScreen onGoogle={()=>signInWithPopup(auth,provider)}/>

  const tabs=[{key:'dashboard',label:'📊 Dashboard'},{key:'meses',label:'📅 Meses'},{key:'independencia',label:'🎯 Independência'}]

  return(
    <div style={{background:'#0a0f1e',minHeight:'100vh',fontFamily:"'DM Sans',sans-serif",color:'#e2e8f0'}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:wght@300;400;500;600&display=swap');*{box-sizing:border-box;margin:0;padding:0;}input:focus{border-color:#4ade80!important;}input::placeholder{color:#475569;}input[type=number]::-webkit-inner-spin-button{opacity:0.3;}::-webkit-scrollbar{width:6px;height:6px;}::-webkit-scrollbar-track{background:#0a0f1e;}::-webkit-scrollbar-thumb{background:#1e293b;border-radius:99px;}button{-webkit-tap-highlight-color:transparent;}input,button{font-size:16px!important;}.nav-desktop{display:flex;gap:4px;overflow-x:auto;}.hamburger-row{display:none;align-items:center;justify-content:space-between;padding:10px 20px;}.hamburger-menu{display:none;flex-direction:column;gap:2px;padding:8px 16px 12px;}@media(max-width:600px){.nav-desktop{display:none!important;}.hamburger-row{display:flex!important;}.hamburger-menu{display:flex!important;}.chart-grid{grid-template-columns:1fr!important;}}`}</style>

      <div style={{padding:'20px 20px 14px',borderBottom:'1px solid #1e293b',background:'linear-gradient(135deg,#0a0f1e,#111827)'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:10}}>
          <div>
            <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:20,color:'#4ade80',letterSpacing:'-0.5px'}}>Controle Financeiro</div>
            <div style={{fontSize:11,color:'#64748b',marginTop:2,display:'flex',alignItems:'center',gap:6}}>
              {user.photoURL&&<img src={user.photoURL} alt="" style={{width:16,height:16,borderRadius:99}}/>}
              {user.displayName||user.email}
              {syncStatus==='salvando'&&<span style={{color:'#facc15'}}>· salvando...</span>}
              {syncStatus==='salvo'&&<span style={{color:'#4ade80'}}>· salvo ✓</span>}
              {syncStatus==='erro'&&<span style={{color:'#f87171'}}>· erro ao salvar</span>}
            </div>
          </div>
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            <button onClick={()=>signOut(auth)} style={{background:'transparent',border:'1px solid #1e293b',color:'#64748b',padding:'6px 10px',borderRadius:8,cursor:'pointer',fontFamily:"'DM Sans',sans-serif",fontSize:12}}>Sair</button>
          </div>
        </div>
      </div>

      <div style={{position:'sticky',top:0,zIndex:10,background:'#111827',borderBottom:'1px solid #1e293b'}}>
        <div className="nav-desktop" style={{padding:'10px 20px'}}>
          {tabs.map(t=>(
            <button key={t.key} onClick={()=>setActiveTab(t.key)} style={{padding:'8px 14px',borderRadius:8,border:'none',background:activeTab===t.key?'#4ade80':'transparent',color:activeTab===t.key?'#0a0f1e':'#64748b',fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:activeTab===t.key?700:500,cursor:'pointer',whiteSpace:'nowrap',transition:'all 0.15s'}}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="hamburger-row">
          <span style={{fontSize:13,fontWeight:600,color:'#e2e8f0'}}>{tabs.find(t=>t.key===activeTab)?.label}</span>
          <button onClick={()=>setMenuOpen(m=>!m)} style={{background:'transparent',border:'1px solid #1e293b',color:'#94a3b8',width:38,height:38,borderRadius:9,cursor:'pointer',fontSize:20,display:'flex',alignItems:'center',justifyContent:'center'}}>
            {menuOpen?'✕':'☰'}
          </button>
        </div>
        {menuOpen&&(
          <>
            <div onClick={()=>setMenuOpen(false)} style={{position:'fixed',top:0,right:0,bottom:0,left:0,zIndex:8}}/>
            <div className="hamburger-menu" style={{position:'relative',zIndex:9}}>
              {tabs.map(t=>(
                <button key={t.key} onClick={()=>{setActiveTab(t.key);setMenuOpen(false)}} style={{padding:'12px 14px',borderRadius:8,border:'none',background:activeTab===t.key?'#4ade8018':'transparent',color:activeTab===t.key?'#4ade80':'#94a3b8',fontFamily:"'DM Sans',sans-serif",fontSize:14,fontWeight:activeTab===t.key?700:500,cursor:'pointer',textAlign:'left',borderLeft:activeTab===t.key?'3px solid #4ade80':'3px solid transparent',transition:'all 0.15s'}}>
                  {t.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div style={{padding:20,maxWidth:900,margin:'0 auto'}}>
        {activeTab==='dashboard'&&<Dashboard year={year} allCats={allCats} metaInv={metaInv} onSetMetaInv={v=>setState(p=>({...p,metaInv:v}))} getDriveToken={getDriveToken}/>}

        {activeTab==='meses'&&(
          <div>
            <div style={{display:'flex',gap:8,overflowX:'auto',paddingBottom:12,marginBottom:16,WebkitOverflowScrolling:'touch'}}>
              {year.map((m,i)=>(
                <MonthCard key={i} month={m} allCats={allCats} isActive={selectedMonth===i} onSelect={()=>setSelectedMonth(i)}/>
              ))}
            </div>
            {(()=>{
              const m=year[selectedMonth]
              const renda=parseFloat(m.renda)||0
              const gasto=allCats.filter(c=>c.key!=='investimento'&&c.key!=='reserva').reduce((s,c)=>s+(parseFloat(m.cats[c.key])||0),0)
              const faturas=m.cards.reduce((s,c)=>s+(parseFloat(c.fatura)||0),0)
              const investido=(parseFloat(m.cats['investimento'])||0)+(parseFloat(m.cats['reserva'])||0)
              const saldo=renda-gasto-faturas-investido
              if(renda<=0) return null
              return(
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(130px,1fr))',gap:8,marginBottom:16}}>
                  {[{label:'Renda',val:renda,color:'#60a5fa'},{label:'Gasto',val:gasto+faturas,color:'#f87171'},{label:'Investido',val:investido,color:'#4ade80'},{label:'Sobra',val:saldo,color:saldo>=0?'#facc15':'#f87171'}].map((k,i)=>(
                    <div key={i} style={{background:'#111827',border:'1px solid #1e293b',borderRadius:10,padding:'10px 12px',textAlign:'center'}}>
                      <div style={{fontSize:10,color:'#64748b',marginBottom:4}}>{k.label}</div>
                      <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:13,color:k.color,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{fmtShort(k.val)}</div>
                    </div>
                  ))}
                </div>
              )
            })()}
            <div style={{background:'#111827',border:'1px solid #1e293b',borderRadius:16,padding:20}}>
              <div style={{marginBottom:20}}>
                <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:20}}>{FULL_MONTHS[selectedMonth]}</div>
                <div style={{fontSize:12,color:'#64748b'}}>Registre renda, gastos e faturas deste mês</div>
              </div>
              <MonthEditor month={year[selectedMonth]} allCats={allCats} customCats={customCats} onChange={data=>updateMonth(selectedMonth,data)} catOps={catOps} prevMonth={selectedMonth>0?year[selectedMonth-1]:null}/>
            </div>
          </div>
        )}

        {activeTab==='independencia'&&<Independence year={year} allCats={allCats} idade={idade} onSetIdade={v=>setState(p=>({...p,idade:v}))}/>}
      </div>
    </div>
  )
}
