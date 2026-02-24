#!/usr/bin/env python3
"""
使用 Google Veo API 为数字人角色生成动作视频
支持多角色：通过 -c 参数指定角色 ID
使用 image_to_video 方法，在 prompt 中强调回到起始姿势
"""

import os
import sys
import time
import argparse
import mimetypes

try:
    from google import genai
    from google.genai import types
except ImportError:
    print("Error: google-genai not installed. Run: pip install google-genai")
    sys.exit(1)

try:
    from PIL import Image
except ImportError:
    print("Error: Pillow not installed. Run: pip install Pillow")
    sys.exit(1)

# 配置
VIDEO_MODEL = "veo-3.1-generate-preview"
TARGET_ASPECT_RATIO = 9 / 16
MIN_WIDTH = 360
MIN_HEIGHT = 640

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(TOOLS_DIR)
CHARACTERS_DIR = os.path.join(PROJECT_DIR, "characters")

# ============================================================
# 角色配置：每个角色的描述和动作提示词
# ============================================================

CHARACTERS = {}

# ---------- 狐小狸 (fox-xiaoli) ----------

_FOX_CHARACTER = (
    "A cute cartoon 3D orange fox cub with big round brown eyes, white fluffy chest fur, "
    "and a bushy orange tail with a white tip, sitting on green grass in a sunlit forest"
)

CHARACTERS["fox-xiaoli"] = {
    "name": "狐小狸",
    "emoji": "🦊",
    "character": _FOX_CHARACTER,
    "videos": {
        "idle": (
            f"{_FOX_CHARACTER}. The little fox sits perfectly still in a calm, relaxed resting pose. "
            "Extremely subtle, lifelike micro-movements only: very slow gentle breathing motion in the chest, "
            "occasional soft blink, and the tiniest ear twitch. "
            "No head movement, no paw movement, no body shifting. "
            "The overall impression is a peaceful, living creature at rest. Very minimal and natural. "
            "The pose at the end is exactly the same as the beginning, creating a seamless loop.",
            6
        ),
        "speaking": (
            f"{_FOX_CHARACTER}. The little fox has subtle mouth movements and gentle facial expression changes. "
            "Its mouth opens and closes slightly as if talking, showing a friendly expression. "
            "Subtle ear twitching. "
            "At the end, it returns to the exact same neutral pose as the beginning with a calm, gentle smile.",
            6
        ),
        "listening": (
            f"{_FOX_CHARACTER}. The little fox turns its head to the side and raises one front paw to its ear, "
            "then holds completely still in this listening pose. "
            "No mouth movement, no blinking, no body movement - perfectly still and focused. "
            "The expression is calm, quiet, and deeply concentrated, like carefully listening to a faint sound. "
            "The pose is maintained motionless throughout, simulating a real attentive listener. "
            "At the end, it slowly lowers its paw and turns back, returning to the exact same neutral pose as the beginning, "
            "with its head centered and a calm expression.",
            6
        ),
        "wave": (
            f"{_FOX_CHARACTER}. The little fox raises one front paw and waves hello with a playful, cheerful expression. "
            "Its tail sways gently with excitement. The movement is cute and energetic. "
            "At the end, it lowers its paw and returns to the exact same neutral pose as the beginning, "
            "sitting calmly with paws on the ground.",
            6
        ),
        "nod": (
            f"{_FOX_CHARACTER}. The little fox simply nods its head up and down slowly and clearly, showing agreement. "
            "Only the head moves - no paw movement, no body movement, no other gestures. "
            "The mouth stays closed, the body stays perfectly still, only the head nods gently. "
            "A soft, approving smile on its face. Minimal and clean motion. "
            "At the end, it stops nodding and returns to the exact same neutral pose as the beginning, "
            "with its head level and a calm expression.",
            6
        ),
        "think": (
            f"{_FOX_CHARACTER}. The little fox shows a thoughtful expression, tilting its head slightly "
            "and looking upward with one paw raised near its chin. Its eyes look contemplative and curious. "
            "At the end, it lowers its paw and returns to the exact same neutral pose as the beginning, "
            "with a calm, neutral expression.",
            6
        ),
        "sneeze": (
            f"{_FOX_CHARACTER}. The little fox's nose twitches rapidly, its eyes squint, "
            "then it lets out an adorable big sneeze - head jerking forward with ears flattening back. "
            "After the sneeze, it shakes its head and looks slightly dazed with a funny expression. "
            "At the end, it returns to the exact same neutral pose as the beginning, "
            "with a calm, gentle smile.",
            6
        ),
        "shy": (
            f"{_FOX_CHARACTER}. The little fox suddenly becomes shy and bashful. "
            "It covers its face with both front paws, ears flatten back, and its tail curls around its body. "
            "It peeks through its paws with one eye, looking adorably embarrassed. "
            "At the end, it lowers its paws and returns to the exact same neutral pose as the beginning, "
            "sitting calmly with a gentle smile.",
            6
        ),
        "tail_wag": (
            f"{_FOX_CHARACTER}. The little fox looks back at its own bushy tail, then starts wagging it "
            "enthusiastically from side to side with pure joy. Its whole body wiggles slightly with the movement. "
            "It looks happy and excited, ears perked up. "
            "At the end, it stops wagging and returns to the exact same neutral pose as the beginning, "
            "sitting calmly facing forward.",
            6
        ),
    },
}

# ---------- 星罗猫 (star-cat) ----------

_CAT_CHARACTER = (
    "A cute cartoon 3D lavender-gray cat with glowing constellation star-line patterns on its fur, "
    "large deep-blue eyes with starlight reflections, small rounded ears with inner purple glow, "
    "wearing a midnight blue hoodie with a crescent moon embroidery on the chest, "
    "fluffy tail with gradient from lavender to deep indigo with twinkling star particles at the tip. "
    "The cat is sitting on dark rooftop tiles at night. "
    "Background: starry sky with constellations, crescent moon, distant warm city lights in soft bokeh, depth-of-field blur"
)

CHARACTERS["star-cat"] = {
    "name": "星罗猫",
    "emoji": "🐱",
    "character": _CAT_CHARACTER,
    "videos": {
        "idle": (
            f"{_CAT_CHARACTER}. The cat sits perfectly still in a calm, elegant posture on the rooftop edge. "
            "Paws neatly together in front, tail gently curled around its body. "
            "Extremely subtle, lifelike micro-movements only: very slow gentle breathing motion, "
            "occasional soft blink. No head movement, no paw movement, no body shifting. "
            "Regal, composed, dignified demeanor. The overall impression is a noble, peaceful creature at rest. "
            "The pose at the end is exactly the same as the beginning, creating a seamless loop.",
            6
        ),
        "speaking": (
            f"{_CAT_CHARACTER}. The cat is speaking with subtle lip movements, "
            "mouth opening and closing gently as if explaining something. "
            "One front paw lifts slightly in a gentle gesture. "
            "Eyes warm and engaged, looking directly at the camera. "
            "The cat remains in a relaxed upright seated pose on the rooftop throughout. "
            "No body shifting, no standing up, no leaning forward or backward. "
            "IMPORTANT: The first frame and last frame must be nearly identical — "
            "the cat in the same calm seated pose, paws together on the ground, head centered, gentle smile. "
            "This ensures seamless looping.",
            6
        ),
        "speaking_v2": (
            f"{_CAT_CHARACTER}. The cat is speaking with subtle natural lip movements. "
            "One front paw lifts just slightly off the ground in a small unconscious gesture, "
            "like a person casually moving their hand while chatting — understated, not exaggerated. "
            "The tail tip sways gently, a slow lazy movement. "
            "Occasional soft blink, relaxed warm eyes looking at the camera. "
            "Natural and conversational, not performative. "
            "The cat remains in a relaxed upright seated pose on the rooftop throughout. "
            "No big movements, no standing up, no leaning forward or backward. "
            "IMPORTANT: The first frame and last frame must be nearly identical — "
            "the cat in the same calm seated pose, paws together on the ground, head centered, gentle smile. "
            "This ensures seamless looping and smooth transition from other speaking clips.",
            6
        ),
        "listening": (
            f"{_CAT_CHARACTER}. The cat tilts its head clearly to one side, "
            "one ear perked up noticeably higher than the other, leaning in attentively. "
            "Eyes wide and focused, looking straight at the camera with full attention. "
            "Mouth firmly closed. Body holds completely still and perfectly steady. "
            "No mouth movement, no fidgeting, no body shifting. "
            "Only the head tilt and ear position show active listening. Still, focused, attentive. "
            "At the end, it slowly straightens its head, returning to the exact same neutral pose as the beginning, "
            "with head centered and a calm expression.",
            6
        ),
        "wave": (
            f"{_CAT_CHARACTER}. The cat raises its right paw up high in a clear friendly wave, "
            "paw pads visible, fingers spread slightly. The left paw stays resting on the rooftop tile. "
            "A cheerful bright smile with eyes slightly squinted from joy. Tail lifts gently behind. "
            "No body shifting from the seated position, no standing up. Only the right paw waves. "
            "At the end, it lowers its paw and returns to the exact same neutral pose as the beginning, "
            "sitting calmly with paws together.",
            6
        ),
        "nod": (
            f"{_CAT_CHARACTER}. The cat simply nods slowly and clearly, chin moving downward toward the chest. "
            "Eyes half-closed with a warm agreeing smile. Only the head moves, body stays perfectly still "
            "in seated position. Both paws rest neatly in front. "
            "No dramatic movement, no body swaying. A gentle, single, clear nod. Subtle and graceful. "
            "At the end, it stops nodding and returns to the exact same neutral pose as the beginning, "
            "with its head level and a calm expression.",
            6
        ),
        "think": (
            f"{_CAT_CHARACTER}. The cat raises one paw to its chin in a classic thinking pose, "
            "looking upward at the starry sky with a contemplative expression. "
            "Eyes gazing up and to the side, eyebrows slightly furrowed in concentration. "
            "The constellation patterns on the fur glow slightly brighter. "
            "Mouth in a small thoughtful pout. Body stays still in seated position. No extra movements. "
            "Only the paw-on-chin and upward gaze show thinking. "
            "At the end, it lowers its paw and returns to the exact same neutral pose as the beginning, "
            "looking straight at the camera with a calm expression.",
            6
        ),
        "sneeze": (
            f"{_CAT_CHARACTER}. The cat squeezes its eyes tightly shut with nose scrunched up, "
            "head tilting back slightly in a sneeze. "
            "Tiny glowing star particles burst from the nose like magical sparkles. "
            "Both paws clutch the front of the hoodie. Constellation patterns on fur flicker. "
            "A cute involuntary expression. No body shifting from seated position. "
            "At the end, it returns to the exact same neutral pose as the beginning, "
            "sitting calmly with a gentle smile.",
            6
        ),
        "shy": (
            f"{_CAT_CHARACTER}. The cat covers its face with both paws in a bashful shy pose, "
            "peeking through the gap between paws with one eye visible. Ears flattened back slightly. "
            "Tail curls tightly around the body. A soft blush glow appears on cheeks. "
            "Body stays in seated position on rooftop. No standing, no body shifting. "
            "Only the paws covering face and peeking eye show shyness. "
            "At the end, it lowers its paws and returns to the exact same neutral pose as the beginning, "
            "sitting calmly with a gentle smile.",
            6
        ),
        "tail_wag": (
            f"{_CAT_CHARACTER}. The cat sits calmly facing the camera. "
            "Its fluffy tail slowly rises behind it and sways gently from side to side, "
            "with a soft faint glow at the tip. "
            "The cat notices its own tail moving and glances back briefly with a small curious smile, "
            "then looks back at the camera with a content, happy expression. "
            "The movement is gentle and lazy, not fast or energetic. "
            "Body stays seated, paws stay on the ground. No standing, no jumping, no paw gestures. "
            "At the end, the tail settles down and the cat returns to the exact same neutral pose as the beginning, "
            "sitting calmly facing the camera with a gentle smile.",
            6
        ),
    },
}


# ============================================================
# 图片处理
# ============================================================

def convert_png_to_jpg(png_path: str) -> str:
    """将 PNG (可能含 RGBA 透明通道) 转为 JPG，返回 JPG 路径"""
    jpg_path = png_path.rsplit('.', 1)[0] + '.jpg'
    if os.path.exists(jpg_path):
        print(f"✓ JPG 已存在: {jpg_path}")
        return jpg_path

    print(f"转换 PNG → JPG: {png_path}")
    img = Image.open(png_path)
    if img.mode == 'RGBA':
        bg = Image.new('RGB', img.size, (0, 0, 0))  # 黑色背景（夜景）
        bg.paste(img, mask=img.split()[3])
        img = bg
    elif img.mode != 'RGB':
        img = img.convert('RGB')
    img.save(jpg_path, quality=95)
    print(f"✓ 转换完成: {jpg_path}")
    return jpg_path


def check_and_crop_image(image_path: str, backup: bool = True) -> tuple:
    """检查图片宽高比，如果不是 9:16 则自动裁剪"""
    img = Image.open(image_path)
    w, h = img.size
    current_ratio = w / h

    print(f"图片尺寸: {w}x{h}, 宽高比: {current_ratio:.4f}")
    print(f"目标宽高比: {TARGET_ASPECT_RATIO:.4f} (9:16)")

    if abs(current_ratio - TARGET_ASPECT_RATIO) < 0.01:
        print("✓ 图片宽高比已经是 9:16，无需裁剪")
        if w < MIN_WIDTH or h < MIN_HEIGHT:
            return False, f"图片尺寸太小（{w}x{h}），最小要求 {MIN_WIDTH}x{MIN_HEIGHT}"
        return True, "图片已符合要求"

    print(f"图片宽高比不是 9:16，需要裁剪...")

    if current_ratio > TARGET_ASPECT_RATIO:
        new_w = int(h * TARGET_ASPECT_RATIO)
        new_h = h
        left = (w - new_w) // 2
        crop_box = (left, 0, left + new_w, h)
        print(f"裁剪方式: 左右裁剪，保留中间 {new_w} 像素宽度")
    else:
        new_w = w
        new_h = int(w / TARGET_ASPECT_RATIO)
        left = 0
        top = (h - new_h) // 2
        crop_box = (left, top, w, top + new_h)
        print(f"裁剪方式: 上下裁剪，保留中间 {new_h} 像素高度")

    if new_w < MIN_WIDTH or new_h < MIN_HEIGHT:
        return False, (
            f"裁剪后尺寸太小（{new_w}x{new_h}），最小要求 {MIN_WIDTH}x{MIN_HEIGHT}。\n"
            f"请上传更大的图片，建议至少 {MIN_WIDTH}x{MIN_HEIGHT} 像素，宽高比接近 9:16。"
        )

    cropped = img.crop(crop_box)

    if backup:
        backup_path = image_path.rsplit('.', 1)
        backup_path = f"{backup_path[0]}_original.{backup_path[1]}"
        if not os.path.exists(backup_path):
            img.save(backup_path)
            print(f"原图已备份到: {backup_path}")

    if image_path.lower().endswith(('.jpg', '.jpeg')):
        cropped.save(image_path, quality=95)
    else:
        cropped.save(image_path)

    print(f"✓ 裁剪完成: {new_w}x{new_h}, 宽高比: {new_w/new_h:.4f}")
    return True, f"图片已裁剪为 {new_w}x{new_h}"


def load_image_as_bytes(image_path: str) -> tuple:
    """加载图片并返回字节数据和MIME类型"""
    with open(image_path, 'rb') as f:
        image_data = f.read()
    mime_type = mimetypes.guess_type(image_path)[0] or 'image/jpeg'
    return image_data, mime_type


# ============================================================
# Veo 视频生成
# ============================================================

def wait_for_video(video_client, operation) -> any:
    """等待视频生成完成"""
    print("    等待视频生成...")
    check_count = 0
    while not operation.done:
        check_count += 1
        print(f"    生成中... (第 {check_count} 次检查)")
        time.sleep(10)
        operation = video_client.operations.get(operation)

    response = operation.response
    if not response:
        print(f"    响应为空，operation: {operation}")
        return None
    if not response.generated_videos:
        print(f"    没有生成视频，response: {response}")
        return None
    return response.generated_videos[0]


def generate_video(video_client, action: str, prompt: str, duration: int,
                   idle_image: str, assets_dir: str) -> str:
    """使用 Veo API 的 image_to_video 方法生成视频"""
    print(f"\n[{action}] 开始生成视频...")
    print(f"  时长: {duration}秒")
    print(f"  起始帧: {idle_image}")

    try:
        image_data, mime_type = load_image_as_bytes(idle_image)
        start_image = types.Image(image_bytes=image_data, mime_type=mime_type)

        config = types.GenerateVideosConfig(
            aspect_ratio="9:16",
            duration_seconds=duration,
            number_of_videos=1,
        )

        print("  发送请求...")
        operation = video_client.models.generate_videos(
            model=VIDEO_MODEL,
            prompt=prompt,
            image=start_image,
            config=config,
        )

        video = wait_for_video(video_client, operation)
        if not video:
            print("  错误: 视频生成失败")
            return None

        output_path = os.path.join(assets_dir, f"{action}.mp4")
        video_client.files.download(file=video.video)
        video.video.save(output_path)
        print(f"  成功! 保存到: {output_path}")
        return output_path

    except Exception as e:
        print(f"  错误: {e}")
        return None


# ============================================================
# 主函数
# ============================================================

def main():
    parser = argparse.ArgumentParser(
        description='使用 Google Veo API 为数字人角色生成动作视频',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=f"可用角色: {', '.join(CHARACTERS.keys())}"
    )
    parser.add_argument('--api-key', '-k', nargs='+', help='Google AI API Key（可提供多个，轮换使用避免配额限制）')
    parser.add_argument('--character', '-c', default='fox-xiaoli',
                        help=f'角色 ID (默认: fox-xiaoli, 可选: {", ".join(CHARACTERS.keys())})')
    parser.add_argument('--action', '-a', help='只生成指定动作的视频')
    parser.add_argument('--list', '-l', action='store_true', help='列出所有可用动作')
    parser.add_argument('--no-crop', action='store_true', help='跳过图片裁剪检查')

    args = parser.parse_args()

    # 验证角色
    if args.character not in CHARACTERS:
        print(f"错误: 未知角色 '{args.character}'")
        print(f"可用角色: {', '.join(CHARACTERS.keys())}")
        return

    char_config = CHARACTERS[args.character]
    char_name = char_config["name"]
    char_emoji = char_config["emoji"]
    videos = char_config["videos"]

    # 角色资源目录
    assets_dir = os.path.join(CHARACTERS_DIR, args.character, "assets")

    if args.list:
        print(f"{char_emoji} {char_name} 可用动作:")
        for action, (prompt, duration) in videos.items():
            print(f"  - {action} ({duration}秒)")
        return

    if not args.api_key:
        parser.error("--api-key / -k 参数是必须的（可提供多个 key 轮换使用）")

    api_keys = args.api_key
    current_key_index = [0]  # 用 list 以便在闭包中修改

    def get_video_client():
        """获取当前 API Key 的 client"""
        return genai.Client(
            http_options={"api_version": "v1beta"},
            api_key=api_keys[current_key_index[0]],
        )

    def rotate_key():
        """切换到下一个 API Key"""
        if len(api_keys) > 1:
            old_idx = current_key_index[0]
            current_key_index[0] = (current_key_index[0] + 1) % len(api_keys)
            print(f"  🔑 切换 API Key: #{old_idx + 1} → #{current_key_index[0] + 1}")
            return True
        return False

    # 查找 idle 图片（支持 jpg 和 png）
    idle_jpg = os.path.join(assets_dir, "idle.jpg")
    idle_png = os.path.join(assets_dir, "idle.png")

    if os.path.exists(idle_jpg):
        idle_image = idle_jpg
    elif os.path.exists(idle_png):
        # PNG → JPG 转换（处理 RGBA 透明通道）
        print("=" * 50)
        print("检测到 PNG 格式，转换为 JPG...")
        print("=" * 50)
        idle_image = convert_png_to_jpg(idle_png)
        print()
    else:
        print(f"错误: 静态图不存在")
        print(f"  请将 idle 图片放到: {assets_dir}/idle.jpg 或 idle.png")
        return

    # 裁剪检查
    if not args.no_crop:
        print("=" * 50)
        print("检查图片尺寸...")
        print("=" * 50)
        success, message = check_and_crop_image(idle_image)
        if not success:
            print(f"\n❌ 错误: {message}")
            return
        print()

    # 选择要生成的动作
    if args.action:
        if args.action not in videos:
            print(f"错误: 未知动作 '{args.action}'")
            print(f"可用动作: {', '.join(videos.keys())}")
            return
        videos_to_generate = {args.action: videos[args.action]}
    else:
        videos_to_generate = videos

    print("=" * 50)
    print(f"{char_emoji} {char_name} - Veo 视频生成器")
    print("=" * 50)
    print(f"角色: {char_name} ({args.character})")
    print(f"模型: {VIDEO_MODEL}")
    print(f"静态图: {idle_image}")
    print(f"输出目录: {assets_dir}")
    print(f"API Keys: {len(api_keys)} 个")
    print(f"待生成视频: {len(videos_to_generate)} 个")
    print("=" * 50)

    success_count = 0
    fail_count = 0

    for action, (prompt, duration) in videos_to_generate.items():
        # 尝试生成，遇到 429 则切换 key 重试
        max_retries = len(api_keys)
        for attempt in range(max_retries):
            video_client = get_video_client()
            result = generate_video(video_client, action, prompt, duration,
                                    idle_image, assets_dir)
            if result:
                success_count += 1
                # 每次成功后也轮换 key，均匀分配配额
                if len(api_keys) > 1:
                    rotate_key()
                break
            elif result is None:
                # 检查是否是配额问题，尝试切换 key
                if rotate_key():
                    print(f"  重试 [{action}]...")
                    continue
                else:
                    fail_count += 1
                    break
        else:
            print(f"  所有 API Key 均已耗尽，跳过 [{action}]")
            fail_count += 1

    print("\n" + "=" * 50)
    print(f"生成完成! 成功: {success_count}, 失败: {fail_count}")
    print("=" * 50)


if __name__ == "__main__":
    main()
