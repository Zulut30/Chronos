import numpy as np, io
from PIL import Image, ImageFilter
im=np.asarray(Image.open('apollo-x4.png').convert('RGB')).astype(np.float32)
h,w,_=im.shape
bg=np.array([23,85,196],np.float32)
d=np.sqrt(((im-bg)**2).sum(-1))
a=np.clip((d-38)/(110-38),0,1)
# soften matte slightly
a=np.asarray(Image.fromarray((a*255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))).astype(np.float32)/255
y=np.arange(h)[:,None]/h
a*=np.clip((0.95-y)/(0.95-0.78),0,1)  # remove baked fog at the bottom
safe=np.maximum(a,0.05)[...,None]
rgb=np.clip((im-(1-safe)*bg)/safe,0,255)
out=np.dstack([rgb,a*255]).astype(np.uint8)
img=Image.fromarray(out,'RGBA')
bbox=img.getchannel('A').point(lambda v:255 if v>8 else 0).getbbox(); print('bbox',bbox,img.size)
img=img.crop(bbox)
for H in ():
    r=img.resize((round(img.width*H/img.height),H),Image.LANCZOS)
    for q in (88,92):
        b=io.BytesIO(); r.save(b,'WEBP',quality=q,method=6,alpha_quality=90); print(H,q,r.size,len(b.getvalue()))
r=img.resize((round(img.width*1700/img.height),1700),Image.LANCZOS)
r.save('apollo-1700.webp','WEBP',quality=90,method=6,alpha_quality=90)
prev=Image.new('RGBA',r.size,(25,82,197,255)); prev.alpha_composite(r); prev.convert('RGB').save('preview-on-blue.png')
d2=Image.new('RGBA',r.size,(8,21,48,255)); d2.alpha_composite(r); d2.convert('RGB').resize((r.width//2,r.height//2)).save('preview-on-dark.png')
