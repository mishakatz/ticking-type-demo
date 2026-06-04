"""ВРЕМЕННОЕ инструментальное средство.

Генерирует циферблаты-заглушки в /assets/dials/ для проверки механики демо
(тик, листание, вычисление фона, fade-in, адаптив) до прихода финальных
ассетов владельца. Заглушки заменяются без изменений в логике движка.

Запуск:  python scripts/make_placeholders.py
"""
import os
from PIL import Image, ImageDraw, ImageFont

SIZE = 2048
C = SIZE // 2
OUT = os.path.join(os.path.dirname(__file__), "..", "assets", "dials")

# Светлые непрозрачные тона — тёмные стрелки читаются, кромка ровная,
# поэтому фон страницы (среднее по кромке) точно совпадёт с циферблатом.
DIALS = [
    ("dial-01.png", (232, 226, 212), (60, 54, 44)),   # тёплый кремовый
    ("dial-02.png", (205, 211, 216), (40, 48, 56)),   # холодный серый
    ("dial-03.png", (210, 220, 201), (48, 58, 42)),   # бледный шалфей
]

def font(px):
    for path in (r"C:\Windows\Fonts\arialbd.ttf", r"C:\Windows\Fonts\arial.ttf"):
        if os.path.exists(path):
            return ImageFont.truetype(path, px)
    return ImageFont.load_default()

def draw_dial(bg, ink):
    img = Image.new("RGB", (SIZE, SIZE), bg)
    d = ImageDraw.Draw(img)
    import math

    # Метки минут/часов по кругу.
    r_out = 960
    for i in range(60):
        a = math.radians(i * 6 - 90)
        is_hour = (i % 5 == 0)
        ln = 70 if is_hour else 28
        w = 14 if is_hour else 6
        x1 = C + r_out * math.cos(a)
        y1 = C + r_out * math.sin(a)
        x2 = C + (r_out - ln) * math.cos(a)
        y2 = C + (r_out - ln) * math.sin(a)
        d.line((x1, y1, x2, y2), fill=ink, width=w)

    # Цифры 12 / 3 / 6 / 9, «12» строго вверху.
    f = font(170)
    r_num = 780
    for label, ang in (("12", -90), ("3", 0), ("6", 90), ("9", 180)):
        a = math.radians(ang)
        cx = C + r_num * math.cos(a)
        cy = C + r_num * math.sin(a)
        d.text((cx, cy), label, font=f, fill=ink, anchor="mm")

    # Точка оси в геометрическом центре.
    d.ellipse((C - 16, C - 16, C + 16, C + 16), fill=ink)
    return img

def main():
    os.makedirs(OUT, exist_ok=True)
    for name, bg, ink in DIALS:
        draw_dial(bg, ink).save(os.path.join(OUT, name), "PNG")
        print("written", name)

if __name__ == "__main__":
    main()
