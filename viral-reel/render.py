import sys,asyncio,os,subprocess,time
from playwright.async_api import async_playwright
BRAND=os.environ.get("BRAND","YOUR CHANNEL")
FPS=30
async def run(times,outdir,prefix="f",start_idx=0,q=92):
    os.makedirs(outdir,exist_ok=True)
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path="/opt/pw-browsers/chromium",args=["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist","--allow-file-access-from-files"])
        pg=await b.new_page(viewport={"width":1080,"height":1920})
        pg.on("console",lambda m:print("console:",m.text) if m.type in("error","warning") else None)
        pg.on("pageerror",lambda e:print("PAGEERR",e))
        await pg.goto(f"http://127.0.0.1:8765/index.html?brand={BRAND}")
        await pg.wait_for_function("window.ready===true && window.fontsOk===true",timeout=60000)
        for i,t in enumerate(times):
            await pg.evaluate(f"setT({t})")
            await pg.screenshot(path=f"{outdir}/{prefix}{start_idx+i:05d}.jpg",type="jpeg",quality=q)
        await b.close()
if __name__=="__main__":
    mode=sys.argv[1]
    if mode=="preview":
        ts=[float(x) for x in sys.argv[2:]]
        asyncio.run(run(ts,"/tmp/prev","p",0,85))
    else:
        a,bb,w=int(sys.argv[2]),int(sys.argv[3]),sys.argv[4]
        asyncio.run(run([i/FPS for i in range(a,bb)],f"frames",f"f",a))
