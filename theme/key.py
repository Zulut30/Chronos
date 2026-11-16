import numpy as np
from PIL import Image
im=np.asarray(Image.open('apollo-x4.png').convert('RGB')).astype(np.float32)
h,w,_=im.shape
border=np.concatenate([im[:40].reshape(-1,3),im[:, :40].reshape(-1,3),im[:, -40:].reshape(-1,3)])
bg=np.median(border,axis=0); print('bg',bg.round())
d=np.sqrt(((im-bg)**2).sum(-1))
print('border dist pct', np.percentile(np.sqrt(((border-bg)**2).sum(-1)),[50,95,99.5]).round(1))
t0,t1=38,110
a=np.clip((d-t0)/(t1-t0),0,1)
# vertical: show fog band stats
for y in range(int(h*.7),h,int(h*.03)):
    print(y, round(float(a[y].mean()),3), im[y, w//2].round())
np.save('alpha.npy',a)
