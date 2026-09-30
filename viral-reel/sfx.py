import numpy as np, wave
SR=44100;DUR=51.0;N=int(SR*DUR)
L=np.zeros(N);R=np.zeros(N)
rng=np.random.default_rng(7)
def add(sig,t,g=1.0,pan=0.0):
    i=int(t*SR)
    if i>=N:return
    s=sig[:N-i]
    L[i:i+len(s)]+=s*g*(1-max(0,pan));R[i:i+len(s)]+=s*g*(1+min(0,pan))
def env(n,a=.005,d=None):
    t=np.arange(n)/SR;d=d or n/SR
    return np.minimum(t/a,1)*np.exp(-t/(d/4))
def lp(x,fc):
    a=np.exp(-2*np.pi*fc/SR);y=np.zeros_like(x);p=0
    for i in range(len(x)):
        p=(1-a)*x[i]+a*p;y[i]=p
    return y
def lpf(x,fc):  # fast lowpass via FFT
    X=np.fft.rfft(x);f=np.fft.rfftfreq(len(x),1/SR);X*=1/(1+(f/fc)**4);return np.fft.irfft(X,len(x))
def hpf(x,fc):
    X=np.fft.rfft(x);f=np.fft.rfftfreq(len(x),1/SR);X*=1-1/(1+(f/fc)**4);return np.fft.irfft(X,len(x))
def kick(d=.35):
    n=int(SR*d);t=np.arange(n)/SR;f=45+120*np.exp(-t*28);ph=2*np.pi*np.cumsum(f)/SR
    return np.sin(ph)*np.exp(-t*9)*1.0+ .3*np.sin(2*np.pi*1800*t)*np.exp(-t*90)
def snare(d=.25):
    n=int(SR*d);t=np.arange(n)/SR;return hpf(rng.standard_normal(n),1500)*np.exp(-t*20)*.6+np.sin(2*np.pi*190*t)*np.exp(-t*25)*.5
def hat(d=.06,o=False):
    n=int(SR*(.25 if o else d));t=np.arange(n)/SR;return hpf(rng.standard_normal(n),7000)*np.exp(-t*(18 if o else 70))*.35
def saw(f,n,det=.006):
    t=np.arange(n)/SR;o=0
    for k in(-1,0,1):o=o+((t*f*(1+k*det))%1*2-1)
    return o/3
def bass(f,d):
    n=int(SR*d);s=saw(f,n,.003);s=lpf(s,380)+np.sin(2*np.pi*f*np.arange(n)/SR)*.6;return s*env(n,.004,d)*.9
def pluck(f,d=.22):
    n=int(SR*d);s=saw(f,n,.004);return lpf(s,2600)*np.exp(-np.arange(n)/SR*14)*.5
def pad(f,d):
    n=int(SR*d);s=saw(f,n,.01);t=np.arange(n)/SR;return lpf(s,1100)*np.minimum(t/.4,1)*np.minimum((d-t)/.4,1)*.25
def riser(d,f0=200,f1=6000):
    n=int(SR*d);t=np.arange(n)/SR;x=rng.standard_normal(n);X=np.fft.rfft(x);f=np.fft.rfftfreq(n,1/SR)
    return None
def whoosh(d=.7,up=True):
    n=int(SR*d);t=np.arange(n)/SR;x=rng.standard_normal(n)
    out=np.zeros(n);blocks=24;bl=n//blocks
    for b in range(blocks):
        p=b/blocks;fc=(400+5500*p) if up else (5900-5500*p)
        seg=x[b*bl:(b+1)*bl];out[b*bl:(b+1)*bl]=lpf(hpf(seg,fc*.4),fc*1.3)
    e=np.sin(np.pi*t/d)**2
    return out*e*.9
def impact(d=1.2):
    n=int(SR*d);t=np.arange(n)/SR;f=90*np.exp(-t*3)+28;ph=2*np.pi*np.cumsum(f)/SR
    return (np.sin(ph)*np.exp(-t*3.2)+lpf(rng.standard_normal(n),900)*np.exp(-t*14)*.6)*1.1
def ding(f=1320,d=.9):
    n=int(SR*d);t=np.arange(n)/SR;return (np.sin(2*np.pi*f*t)+.4*np.sin(2*np.pi*f*2.01*t)+.2*np.sin(2*np.pi*f*3.02*t))*np.exp(-t*5)*.45
def coin(t0):
    f=2400+rng.random()*800;n=int(SR*.35);t=np.arange(n)/SR
    return (np.sin(2*np.pi*f*t)+np.sin(2*np.pi*f*1.5*t)*.6)*np.exp(-t*14)*.3
def pop(f=520,d=.14):
    n=int(SR*d);t=np.arange(n)/SR;ff=f*(1+2*np.exp(-t*40));ph=2*np.pi*np.cumsum(ff)/SR;return np.sin(ph)*np.exp(-t*30)*.6
def siren(d,f0,f1):
    n=int(SR*d);t=np.arange(n)/SR;f=f0+(f1-f0)*(0.5+0.5*np.sin(2*np.pi*3.5*t));ph=2*np.pi*np.cumsum(f)/SR;return np.sign(np.sin(ph))*.25*np.minimum(t/.05,1)*np.minimum((d-t)/.1,1)*np.exp(-t*.8)

BPM=140;B=60/BPM
cuts=[2.4,9.2,13.8,17.2,22.2,28.0,31.3,37.6,41.8,46.94]
# hook
add(impact(),0.02,1.0);add(whoosh(.5,False),0.0,.5)
add(siren(.93,700,1250),1.46,.5)
for i in range(6):add(pop(300+i*30),.25+i*.05,.25) if False else None
# beat starts at hook end
start=2.4;t=start;bar=0
prog=[55.0,43.65,65.41,49.0]  # A1 F1 C2 G1
chords=[[220,261.6,329.6],[174.6,220,261.6],[261.6,329.6,392],[196,246.9,293.7]]
n_beats=int((46.94-start)/B)
for k in range(n_beats+1):
    tb=start+k*B
    if tb>=47.0:break
    add(kick(),tb,.95)
    if k%2==1:add(snare(),tb,.55)
    for h in (0,.5):add(hat(),tb+h*B,.4 if h==0 else .3)
    add(hat(o=True),tb+.75*B,.25) if k%4==3 else None
    # bass 8ths
    bf=prog[(k//4)%4]
    for h in (0,.5):
        f=bf*(2 if (k*2+int(h*2))%4==3 else 1)
        add(bass(f,B*.48),tb+h*B,.8)
    if k%4==0:
        for f in chords[(k//4)%4]:add(pad(f,B*4),tb,.5,pan=.3)
    if tb>=22.2:  # arp
        sc=chords[(k//4)%4]
        for q in range(4):
            f=sc[(q+k)%3]*(2 if q%2 else 1)
            add(pluck(f),tb+q*B/4,.35,pan=(-.4 if q%2 else .4))
# risers before cuts and impacts
for c in cuts:
    add(whoosh(.55,True),c-.5,.55);add(impact(.9),c,.75)
add(whoosh(1.2,True),13.2,.5) # extra pre-prize
# coin rain
for i in range(28):add(coin(0),15.4+i*.06+rng.random()*.03,.6,pan=rng.uniform(-.7,.7))
# count-up ticks (D)
for i in range(18):add(pop(900+i*40,.06),15.5+i*.07,.25)
# reminder set / dm
add(ding(1568),24.35+ .0,.8);add(ding(1976,1.0),25.95,.7);add(pop(700),26.2,.6);add(whoosh(.35,True),26.05,.5)
# rules ticks
for i in range(5):add(ding(1200+i*100,.35),28.65+i*.35,.55)
# share
add(pop(640),32.3,.6);add(whoosh(.5,True),32.1,.4)
for i in range(3):add(pop(500+i*120),33.3+i*.25,.6)
add(ding(1046,1.4),35.4,.8);add(ding(1318,1.4),35.5,.7);add(ding(1568,1.8),35.6,.7)
# I tiles
for i in range(3):add(whoosh(.3,True),37.85+i*.45,.4);add(pop(400+i*80),38.05+i*.45,.5)
# CTA pops
for a in (41.95,43.85,44.8):add(pop(760),a,.8);add(ding(1760,.5),a+.05,.4)
# outro
add(impact(2.2),46.94,1.0)
for f in (220,277.2,329.6,440):add(pad(f,4.2),47.0,.9)
add(ding(1760,2.5),47.3,.5)
# final fade
fade=np.clip((DUR-np.arange(N)/SR)/1.6,0,1)
L*=fade;R*=fade
def norm(x):return x
m=max(np.abs(L).max(),np.abs(R).max());L/=m;R/=m
out=(np.stack([L,R],1)*32000*0.9).astype(np.int16)
w=wave.open('music_sfx.wav','wb');w.setnchannels(2);w.setsampwidth(2);w.setframerate(SR);w.writeframes(out.tobytes());w.close()
print("ok")
