"""Оценка эффекта (экономика и экология) для слайдов. Запуск из корня: python3 impact/calc.py. Все допущения — в коде ниже.
Impact calc for ATU waste registry. DB read-only. Demo data is SYNTHETIC. Run: python3 -I calc.py"""
import sqlite3
import os
DB='file:'+os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','data','waste.db')+'?mode=ro'
c=sqlite3.connect(DB,uri=True)
rows=c.execute("""select e.qty*w.kg_per_unit kg,w.category,w.recyclable,w.co2_factor,m.is_recycling,w.name,e.date
from entries e join reports r on r.id=e.report_id join waste_types w on w.id=e.waste_type_id
join disposal_methods m on m.id=e.method_id where r.status='accepted'""").fetchall()
dates=[r[6] for r in rows]
from datetime import date
d0,d1=[date.fromisoformat(x) for x in (min(dates),max(dates))]
days=(d1-d0).days+1
REC=0.0089   # project factor for recycling/compost (DEFRA 2023: composting 8.91 kg/t; plastics closed-loop 21.28 kg/t)
tot=sum(r[0] for r in rows)
def co2(rows,board=None):
    s=0
    for kg,cat,rc,f,isr,n,_ in rows:
        if board and n=='Картонная тара': f=board
        s+= kg*(REC if isr else f)
    return s
print(f"days={days} entries={len(rows)} total_kg={tot:.0f} kg/day={tot/days:.1f}")
food=sum(r[0] for r in rows if r[1] in ('food','organic'))
recyc=sum(r[0] for r in rows if r[2]); recd=sum(r[0] for r in rows if r[4])
print(f"food share={food/tot:.1%} recyclable share={recyc/tot:.1%} actually recycled={recd/tot:.1%}")
base_co2=co2(rows); b2=co2(rows,1.164)
res={}
for name,ann_days in (('base',365),('cons',300)):
    k=ann_days/days
    t=tot*k/1000; e=base_co2*k/1000
    print(f"[{name}] annual waste={t:.2f} t, CO2e={e:.2f} t (board 1.164: {b2*k/1000:.2f})")
    res[name]=(t,e,k)
# scenarios (annual, base extrapolation)
k=365/days
def scen(red):
    r2=[(x[0]*(1-red),)+x[1:] for x in rows]
    return co2(r2)*k/1000
# divert recyclable non-recycled to recycling/compost
div=[(x[0],x[1],x[2],x[3],1 if x[2] else x[4],x[5],x[6]) for x in rows]
print("divert-able kg/yr(base):",sum(x[0] for x in rows if x[2] and not x[4])*k)
for lab,v in (('-10%',scen(.1)),('-20%',scen(.2)),('divert recyclable',co2(div)*k/1000)):
    print(f"{lab}: CO2e/yr={v:.2f} t, saving={base_co2*k/1000-v:.2f} t")
d20=[(x[0]*.8,)+x[1:4]+(1 if x[2] else x[4],)+x[5:] for x in rows]
print(f"-20% + divert: CO2e={co2(d20)*k/1000:.2f}, saving={base_co2*k/1000-co2(d20)*k/1000:.2f}")
# avoidable-food kg (assumption: sales leftovers/plate/sample waste)
av=sum(r[0] for r in rows if r[1] in ('food','organic') and any(s in r[5] for s in ('Остатки','из зала','образцов')))
print(f"avoidable food kg in sample={av:.0f} ({av/tot:.1%} of waste) -> kg/yr base={av*k:.0f}")
# ECONOMICS (ASSUMPTIONS flagged A)
SAL=473158; H=168; rate=SAL/H   # BNS KZ avg nominal wage Q4 2025 (national; Almaty figure not found)
print(f"rate={rate:.0f} KZT/h")
S={'base':dict(logas=0.33,logto=0.15,consas=6.0,consto=1.0,rep_as=4.0,rep_to=0.7,capex_dev=2.5e6,hw=5*(90e3+35e3),vps=8e3,sup=50e3,price=700,red=.10,avshare=1.0,ak=365),
   'cons':dict(logas=0.25,logto=0.17,consas=4.0,consto=1.5,rep_as=3.0,rep_to=1.0,capex_dev=4.0e6,hw=5*(90e3+35e3),vps=12e3,sup=100e3,price=400,red=.05,avshare=1.0,ak=300)}
for n,p in S.items():
    as_h=5*22*p['logas']+5*p['consas']+p['rep_as']; to_h=5*22*p['logto']+5*p['consto']+p['rep_to']
    lab=(as_h-to_h)*rate
    kgy=av*p['ak']/days
    purch=kgy*p['red']*p['price']/12
    opex=p['vps']+p['sup']; capex=p['capex_dev']+p['hw']
    net=lab+purch-opex
    print(f"[{n}] hours/mo as-is={as_h:.0f} to-be={to_h:.0f} saved={as_h-to_h:.0f} labor KZT/mo={lab:,.0f}; purchase saving/mo={purch:,.0f}; OPEX/mo={opex:,.0f}; CAPEX={capex:,.0f}; net/mo={net:,.0f}; payback={capex/net if net>0 else float('inf'):.1f} mo; 5y net={net*60-capex:,.0f}")
# SCALE: 113 vuzes (BNS 2024/25); assumption: ATU = food-tech vuz w/ 5 orgs; others scale factor
V=113
for n,f in (('base',0.5),('cons',0.2)):
    t,e,_=res['base' if n=='base' else 'cons']
    print(f"[{n}] scale factor {f}: {V} vuzes -> waste {t*f*V:,.0f} t/yr, CO2e {e*f*V:,.0f} t/yr; -20%/diversion effect needs per-scenario")
