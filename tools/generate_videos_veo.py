#!/usr/bin/env python3
"""
使用 Google Veo API 生成狐小狸数字人视频
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

PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
ASSETS_DIR = os.path.join(PROJECT_DIR, "assets")
IDLE_IMAGE = os.path.join(ASSETS_DIR, "idle.jpg")

# 角色描述（统一用于所有 prompt）
CHARACTER = (
    "A cute cartoon 3D orange fox cub with big round brown eyes, white fluffy chest fur, "
    "and a bushy orange tail with a white tip, sitting on green grass in a sunlit forest"
)

# 视频配置：动作名称 -> (提示词, 时长)
VIDEOS = {
    "idle": (
        f"{CHARACTER}. The little fox sits perfectly still in a calm, relaxed resting pose. "
        "Extremely subtle, lifelike micro-movements only: very slow gentle breathing motion in the chest, "
        "occasional soft blink, and the tiniest ear twitch. "
        "No head movement, no paw movement, no body shifting. "
        "The overall impression is a peaceful, living creature at rest. Very minimal and natural. "
        "The pose at the end is exactly the same as the beginning, creating a seamless loop.",
        6
    ),
    "speaking": (
        f"{CHARACTER}. The little fox has subtle mouth movements and gentle facial expression changes. "
        "Its mouth opens and closes slightly as if talking, showing a friendly expression. "
        "Subtle ear twitching. "
        "At the end, it returns to the exact same neutral pose as the beginning with a calm, gentle smile.",
        6
    ),
    "listening": (
        f"{CHARACTER}. The little fox turns its head to the side and raises one front paw to its ear, "
        "then holds completely still in this listening pose. "
        "No mouth movement, no blinking, no body movement - perfectly still and focused. "
        "The expression is calm, quiet, and deeply concentrated, like carefully listening to a faint sound. "
        "The pose is maintained motionless throughout, simulating a real attentive listener. "
        "At the end, it slowly lowers its paw and turns back, returning to the exact same neutral pose as the beginning, "
        "with its head centered and a calm expression.",
        6
    ),
    "wave": (
        f"{CHARACTER}. The little fox raises one front paw and waves hello with a playful, cheerful expression. "
        "Its tail sways gently with excitement. The movement is cute and energetic. "
        "At the end, it lowers its paw and returns to the exact same neutral pose as the beginning, "
        "sitting calmly with paws on the ground.",
        6
    ),
    "nod": (
        f"{CHARACTER}. The little fox simply nods its head up and down slowly and clearly, showing agreement. "
        "Only the head moves - no paw movement, no body movement, no other gestures. "
        "The mouth stays closed, the body stays perfectly still, only the head nods gently. "
        "A soft, approving smile on its face. Minimal and clean motion. "
        "At the end, it stops nodding and returns to the exact same neutral pose as the beginning, "
        "with its head level and a calm expression.",
        6
    ),
    "think": (
        f"{CHARACTER}. The little fox shows a thoughtful expression, tilting its head slightly "
        "and looking upward with one paw raised near its chin. Its eyes look contemplative and curious. "
        "At the end, it lowers its paw and returns to the exact same neutral pose as the beginning, "
        "with a calm, neutral expression.",
        6
    ),
    "sneeze": (
        f"{CHARACTER}. The little fox's nose twitches rapidly, its eyes squint, "
        "then it lets out an adorable big sneeze - head jerking forward with ears flattening back. "
        "After the sneeze, it shakes its head and looks slightly dazed with a funny expression. "
        "At the end, it returns to the exact same neutral pose as the beginning, "
        "with a calm, gentle smile.",
        6
    ),
    "shy": (
        f"{CHARACTER}. The little fox suddenly becomes shy and bashful. "
        "It covers its face with both front paws, ears flatten back, and its tail curls around its body. "
        "It peeks through its paws with one eye, looking adorably embarrassed. "
        "At the end, it lowers its paws and returns to the exact same neutral pose as the beginning, "
        "sitting calmly with a gentle smile.",
        6
    ),
    "tail_wag": (
        f"{CHARACTER}. The little fox looks back at its own bushy tail, then starts wagging it "
        "enthusiastically from side to side with pure joy. Its whole body wiggles slightly with the movement. "
        "It looks happy and excited, ears perked up. "
        "At the end, it stops wagging and returns to the exact same neutral pose as the beginning, "
        "sitting calmly facing forward.",
        6
    ),
}


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


def generate_video(video_client, action: str, prompt: str, duration: int) -> str:
    """使用 Veo API 的 image_to_video 方法生成视频"""
    print(f"\n[{action}] 开始生成视频...")
    print(f"  时长: {duration}秒")
    print(f"  起始帧: {IDLE_IMAGE}")

    try:
        image_data, mime_type = load_image_as_bytes(IDLE_IMAGE)
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

        output_path = os.path.join(ASSETS_DIR, f"{action}.mp4")
        video_client.files.download(file=video.video)
        video.video.save(output_path)
        print(f"  成功! 保存到: {output_path}")
        return output_path

    except Exception as e:
        print(f"  错误: {e}")
        return None


def main():
    parser = argparse.ArgumentParser(description='使用 Google Veo API 生成狐小狸数字人视频')
    parser.add_argument('--api-key', '-k', required=True, help='Google AI API Key')
    parser.add_argument('--action', '-a', help='只生成指定动作的视频')
    parser.add_argument('--list', '-l', action='store_true', help='列出所有可用动作')
    parser.add_argument('--no-crop', action='store_true', help='跳过图片裁剪检查')

    args = parser.parse_args()

    if args.list:
        print("可用动作:")
        for action, (prompt, duration) in VIDEOS.items():
            print(f"  - {action} ({duration}秒)")
        return

    if not os.path.exists(IDLE_IMAGE):
        print(f"错误: 静态图不存在: {IDLE_IMAGE}")
        return

    if not args.no_crop:
        print("=" * 50)
        print("检查图片尺寸...")
        print("=" * 50)
        success, message = check_and_crop_image(IDLE_IMAGE)
        if not success:
            print(f"\n❌ 错误: {message}")
            return
        print()

    video_client = genai.Client(
        http_options={"api_version": "v1beta"},
        api_key=args.api_key,
    )

    if args.action:
        if args.action not in VIDEOS:
            print(f"错误: 未知动作 '{args.action}'")
            print(f"可用动作: {', '.join(VIDEOS.keys())}")
            return
        videos_to_generate = {args.action: VIDEOS[args.action]}
    else:
        videos_to_generate = VIDEOS

    print("=" * 50)
    print("🦊 狐小狸 - Veo 视频生成器")
    print("=" * 50)
    print(f"模型: {VIDEO_MODEL}")
    print(f"静态图: {IDLE_IMAGE}")
    print(f"输出目录: {ASSETS_DIR}")
    print(f"待生成视频: {len(videos_to_generate)} 个")
    print("=" * 50)

    success_count = 0
    fail_count = 0

    for action, (prompt, duration) in videos_to_generate.items():
        result = generate_video(video_client, action, prompt, duration)
        if result:
            success_count += 1
        else:
            fail_count += 1

    print("\n" + "=" * 50)
    print(f"生成完成! 成功: {success_count}, 失败: {fail_count}")
    print("=" * 50)


if __name__ == "__main__":
    main()
