from PIL import Image, ImageDraw
import os
os.makedirs("icons", exist_ok=True)
def icon(size, pad_ratio, path, bg=(43,93,168)):
    im = Image.new("RGB", (size,size), bg); d = ImageDraw.Draw(im)
    p = int(size*pad_ratio); w = size-2*p; h = int(w*0.72); x0 = p; y0 = (size-h)//2; r = int(size*0.05)
    d.rounded_rectangle([x0+int(w*0.06), y0-int(h*0.10), x0+w-int(w*0.06), y0+h-int(h*0.10)], radius=r, fill=(214,226,243))
    d.rounded_rectangle([x0, y0, x0+w, y0+h], radius=r, fill=(255,255,255))
    ry = y0+int(h*0.26); d.rectangle([x0, ry, x0+w, ry+max(2,int(size*0.018))], fill=(204,53,70))
    step = int(h*0.15); y = ry+step
    while y < y0+h-int(h*0.08):
        d.rectangle([x0+int(w*0.08), y, x0+w-int(w*0.08), y+max(1,int(size*0.008))], fill=(207,221,240)); y += step
    im.save(path)
icon(192, 0.16, "icons/icon-192.png"); icon(512, 0.16, "icons/icon-512.png")
icon(512, 0.24, "icons/icon-maskable-512.png"); icon(180, 0.14, "icons/apple-touch-icon.png")
