import re,functools,json
PH=["BGMI players,","ready ho jao!","Kyunki 27 September ko hone wala hai hamara first BGMI tournament.","Aur match start hoga shaam 6:30 baje.","Sabse khas baat—","yeh hoga solo match,","matlab pura game tumhare skills par depend karega.","Entry fee sirf ₹50 hai","aur winning amount hai ₹500!","To agar tum BGMI khelte ho,","yeh opportunity miss mat karna.","Abhi calendar mein 27 September,","6:30 PM ka reminder laga lo","aur registration ke liye humen DM karo.","Hum tumhe tournament ke saare rules aur regulations send kar denge.","Aur haan,","apne BGMI wale doston ko yeh reel zaroor share karna","kyunki ho sakta hai next winner tumhara hi dost ho.","Hum BGMI, Free Fire aur bhi kaafi games ke tournaments host karte rehte hain.","To late mat karo,","follow karo,","reel share karo","aur participate karne ke liye humen DM karo.","See you in the match!"]
def syl(s):
    s=s.replace("BGMI","bee jee em eye").replace("PM","pee em").replace("27","sattaais").replace("6:30","chhe tees").replace("₹50","pachaas rupaye").replace("₹500","paanch sau rupaye").replace("DM","dee em")
    return max(1,len(re.findall(r"[aeiouy]+",s.lower())))
S=[syl(p) for p in PH];T=sum(S)
P=[(1.38,1.54),(2.3,2.48),(5.66,6.26),(8.88,9.5),(10.3,10.5),(11.46,11.62),(13.6,14.02),(15.3,15.9),(16.72,17.72),(18.34,18.98),(21.94,22.5),(24.02,24.18),(25.98,26.1),(27.68,28.28),(30.8,31.76),(32.26,32.52),(35.3,35.42),(37.26,37.86),(38.76,39.04),(41.4,42.26),(42.94,43.34),(43.76,43.98),(44.7,44.92),(46.72,47.16)]
a,b=0.3,47.9
cum=0;est=[]
for s in S[:-1]:
    cum+=s;est.append(a+(b-a)*cum/T)
def cost(i,k):
    m=(P[i][0]+P[i][1])/2;ln=P[i][1]-P[i][0]
    return (m-est[k])**2/1.5-6*ln
@functools.lru_cache(None)
def f(k,s):
    if k==len(est):return 0,()
    best=(1e9,())
    for i in range(s,len(P)):
        c,p=f(k+1,i+1);c+=cost(i,k)
        if c<best[0]:best=(c,(i,)+p)
    return best
c,p=f(0,0)
b_=[a]+[ (P[i][0]+P[i][1])/2 for i in p]+[b]
for k,t in enumerate(PH):
    d=b_[k+1]-b_[k];print(f"{b_[k]:5.2f}-{b_[k+1]:5.2f} {d:4.1f}s {S[k]/d:4.1f}syl/s {t}")
json.dump([{"t":PH[k],"s":round(b_[k],2),"e":round(b_[k+1],2)} for k in range(len(PH))],open("phrases.json","w"),ensure_ascii=False,indent=1)
