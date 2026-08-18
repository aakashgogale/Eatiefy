
from PIL import Image

def remove_white_bg(input_path, output_path):
    img = Image.open(input_path)
    img = img.convert('RGBA')
    datas = img.getdata()

    newData = []
    threshold = 240
    for item in datas:
        if item[0] >= threshold and item[1] >= threshold and item[2] >= threshold:
            newData.append((255, 255, 255, 0))
        else:
            newData.append(item)
            
    img.putdata(newData)
    img.save(output_path, 'PNG')

remove_white_bg('public/deliveryboy-3d.jpeg', 'public/deliveryboy-3d-transparent.png')
remove_white_bg('src/modules/Food/assets/deliveryboy-3d.jpeg', 'src/modules/Food/assets/deliveryboy-3d-transparent.png')
print('Done!')

