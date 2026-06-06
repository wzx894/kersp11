#!/bin/sh

# ============================================================
# Kerkerker 一键部署脚本
# ============================================================
# 支持系统: Ubuntu, Debian, CentOS, RHEL, Alpine, macOS, Arch Linux
# 使用方法:
#   curl -fsSL https://raw.githubusercontent.com/unilei/kerkerker/master/scripts/install.sh | sh
#   或
#   wget -qO- https://raw.githubusercontent.com/unilei/kerkerker/master/scripts/install.sh | sh
# ============================================================

set -e

# ==================== 系统检测 ====================
detect_os() {
    OS=""
    ARCH=""
    PKG_MANAGER=""
    
    # 检测架构
    case "$(uname -m)" in
        x86_64|amd64) ARCH="amd64" ;;
        aarch64|arm64) ARCH="arm64" ;;
        armv7l) ARCH="armv7" ;;
        *) ARCH="unknown" ;;
    esac
    
    # 检测操作系统
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS="$ID"
        OS_VERSION="$VERSION_ID"
    elif [ -f /etc/redhat-release ]; then
        OS="rhel"
    elif [ "$(uname)" = "Darwin" ]; then
        OS="macos"
    else
        OS="unknown"
    fi
    
    # 检测包管理器
    case "$OS" in
        ubuntu|debian|linuxmint|pop) PKG_MANAGER="apt" ;;
        centos|rhel|fedora|rocky|almalinux) PKG_MANAGER="yum" ;;
        alpine) PKG_MANAGER="apk" ;;
        arch|manjaro) PKG_MANAGER="pacman" ;;
        macos) PKG_MANAGER="brew" ;;
        *) PKG_MANAGER="unknown" ;;
    esac
}

# 初始化系统检测
detect_os

# ==================== 颜色定义 ====================
# 检测终端是否支持颜色
if [ -t 1 ] && command -v tput >/dev/null 2>&1 && [ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    BLUE='\033[0;34m'
    CYAN='\033[0;36m'
    BOLD='\033[1m'
    NC='\033[0m'
else
    RED=''
    GREEN=''
    YELLOW=''
    BLUE=''
    CYAN=''
    BOLD=''
    NC=''
fi

# ==================== 配置 ====================
SCRIPT_VERSION="1.1.0"
SCRIPT_DATE="2025-12-26"
DOCKER_IMAGE="unilei/kerkerker"
DEFAULT_VERSION="latest"
DEFAULT_PORT="3000"
INSTALL_DIR="${KERKERKER_INSTALL_DIR:-$HOME/kerkerker}"

# ==================== 工具函数 ====================
# POSIX 兼容的 printf 输出
print_color() {
    printf '%b' "$1"
}

print_banner() {
    print_color "${CYAN}"
    echo "╔═══════════════════════════════════════════════════════════╗"
    echo "║                                                           ║"
    print_color "║   ${BOLD}🎬 Kerkerker 一键部署脚本${NC}${CYAN}                              ║\n"
    echo "║                                                           ║"
    echo "║   短剧/影视管理平台                                       ║"
    echo "║                                                           ║"
    print_color "║   版本: ${SCRIPT_VERSION}  更新: ${SCRIPT_DATE}                          ║\n"
    echo "╚═══════════════════════════════════════════════════════════╝"
    print_color "${NC}\n"
    # 显示系统信息
    print_color "${CYAN}   系统: ${OS} (${ARCH})${NC}\n"
    echo ""
}

print_step() {
    printf '\n%b==>%b %b%s%b\n' "${BLUE}" "${NC}" "${BOLD}" "$1" "${NC}"
}

print_info() {
    printf '%bℹ%b  %s\n' "${BLUE}" "${NC}" "$1"
}

print_success() {
    printf '%b✔%b  %s\n' "${GREEN}" "${NC}" "$1"
}

print_warning() {
    printf '%b⚠%b  %s\n' "${YELLOW}" "${NC}" "$1"
}

print_error() {
    printf '%b✖%b  %s\n' "${RED}" "${NC}" "$1"
}

# 读取用户输入（支持默认值和密码模式）
# 注意：从 /dev/tty 读取，以支持 curl | sh 方式运行
read_input() {
    _prompt="$1"
    _default="$2"
    _is_password="$3"
    _value=""
    
    if [ -n "$_default" ] && [ "$_is_password" != "true" ]; then
        _prompt="${_prompt} [${_default}]"
    fi
    
    # 输出提示到 /dev/tty（确保在终端显示，即使通过管道运行）
    if [ -e /dev/tty ]; then
        if [ "$_is_password" = "true" ]; then
            printf '%b?%b %s: ' "${CYAN}" "${NC}" "$_prompt" > /dev/tty
            stty -echo 2>/dev/null || true
            read _value < /dev/tty
            stty echo 2>/dev/null || true
            echo "" > /dev/tty
        else
            printf '%b?%b %s: ' "${CYAN}" "${NC}" "$_prompt" > /dev/tty
            read _value < /dev/tty
        fi
    else
        # 回退：无 /dev/tty 时使用标准输入输出
        printf '%b?%b %s: ' "${CYAN}" "${NC}" "$_prompt" >&2
        if [ "$_is_password" = "true" ]; then
            stty -echo 2>/dev/null || true
            read _value
            stty echo 2>/dev/null || true
            echo "" >&2
        else
            read _value
        fi
    fi
    
    if [ -z "$_value" ] && [ -n "$_default" ]; then
        echo "$_default"
    else
        echo "$_value"
    fi
}

# 验证端口号 (POSIX 兼容)
validate_port() {
    _port="$1"
    case "$_port" in
        ''|*[!0-9]*) return 1 ;;
    esac
    [ "$_port" -ge 1 ] && [ "$_port" -le 65535 ]
}

# 检查命令是否存在
command_exists() {
    command -v "$1" > /dev/null 2>&1
}

# 检查端口是否可用 (POSIX 兼容)
check_port_available() {
    _port="$1"
    if command_exists ss; then
        ss -tuln 2>/dev/null | grep -q ":$_port " && return 1
    elif command_exists netstat; then
        netstat -tuln 2>/dev/null | grep -q ":$_port " && return 1
    elif command_exists lsof; then
        lsof -i ":$_port" > /dev/null 2>&1 && return 1
    fi
    return 0
}

# ==================== Docker 安装辅助 ====================
install_docker_hint() {
    echo ""
    print_info "根据您的系统，可以使用以下命令安装 Docker:"
    echo ""
    case "$PKG_MANAGER" in
        apt)
            echo "   # Ubuntu/Debian"
            echo "   curl -fsSL https://get.docker.com | sh"
            echo "   sudo usermod -aG docker \$USER"
            ;;
        yum)
            echo "   # CentOS/RHEL"
            echo "   curl -fsSL https://get.docker.com | sh"
            echo "   sudo systemctl enable --now docker"
            echo "   sudo usermod -aG docker \$USER"
            ;;
        apk)
            echo "   # Alpine"
            echo "   apk add docker docker-compose"
            echo "   rc-update add docker boot"
            echo "   service docker start"
            ;;
        pacman)
            echo "   # Arch Linux"
            echo "   pacman -S docker docker-compose"
            echo "   systemctl enable --now docker"
            echo "   usermod -aG docker \$USER"
            ;;
        brew)
            echo "   # macOS"
            echo "   brew install --cask docker"
            echo "   # 然后启动 Docker Desktop"
            ;;
        *)
            echo "   请访问: https://docs.docker.com/get-docker/"
            ;;
    esac
    echo ""
    print_info "安装完成后，请重新登录或执行 'newgrp docker'，然后重新运行此脚本"
}

# ==================== 检查依赖 ====================
check_dependencies() {
    print_step "检查系统依赖"
    
    _has_docker=0
    _has_compose=0
    
    # 检查 Docker
    if command_exists docker; then
        print_success "Docker 已安装"
        _has_docker=1
    else
        print_error "Docker 未安装"
    fi
    
    # 检查 Docker Compose
    if command_exists docker-compose; then
        print_success "Docker Compose 已安装 (standalone)"
        COMPOSE_CMD="docker-compose"
        _has_compose=1
    elif docker compose version > /dev/null 2>&1; then
        print_success "Docker Compose 已安装 (plugin)"
        COMPOSE_CMD="docker compose"
        _has_compose=1
    else
        print_error "Docker Compose 未安装"
    fi
    
    # 检查 curl
    if ! command_exists curl; then
        print_warning "curl 未安装（健康检查将跳过）"
    else
        print_success "curl 已安装"
    fi
    
    # 如果有缺失的依赖
    if [ "$_has_docker" = "0" ] || [ "$_has_compose" = "0" ]; then
        install_docker_hint
        exit 1
    fi
    
    # 检查 Docker 是否运行
    if ! docker info > /dev/null 2>&1; then
        print_error "Docker 未运行"
        echo ""
        case "$OS" in
            macos)
                print_info "请启动 Docker Desktop 应用"
                ;;
            *)
                print_info "请执行: sudo systemctl start docker"
                ;;
        esac
        exit 1
    fi
    print_success "Docker 运行正常"
}

# ==================== 检测已存在安装 ====================
check_existing_installation() {
    if [ -f "$INSTALL_DIR/.env" ] && [ -f "$INSTALL_DIR/docker-compose.yml" ]; then
        print_warning "检测到已存在的安装: $INSTALL_DIR"
        echo ""
        echo "   1) 升级 - 保留现有配置，只更新镜像和脚本"
        echo "   2) 重装 - 备份后重新配置"
        echo "   3) 取消"
        echo ""
        _choice=$(read_input "请选择操作" "1")
        case "$_choice" in
            1)
                UPGRADE_MODE=true
                # 加载现有配置
                set -a
                . "$INSTALL_DIR/.env"
                set +a
                print_info "将保留现有配置进行升级"
                ;;
            2)
                # 备份现有配置
                _backup_dir="$INSTALL_DIR.backup.$(date +%Y%m%d_%H%M%S)"
                mv "$INSTALL_DIR" "$_backup_dir"
                print_info "已备份到: $_backup_dir"
                UPGRADE_MODE=false
                ;;
            *)
                print_info "已取消"
                exit 0
                ;;
        esac
    else
        UPGRADE_MODE=false
    fi
}

# ==================== 交互式配置 ====================
interactive_config() {
    print_step "配置部署参数"
    echo ""
    print_info "请根据提示输入配置信息（直接回车使用默认值）"
    echo ""
    
    # 安装目录
    INSTALL_DIR=$(read_input "安装目录" "$INSTALL_DIR")
    
    # 应用端口
    while true; do
        APP_PORT=$(read_input "应用端口" "$DEFAULT_PORT")
        if ! validate_port "$APP_PORT"; then
            print_error "无效的端口号，请输入 1-65535 之间的数字"
            continue
        fi
        if ! check_port_available "$APP_PORT"; then
            print_warning "端口 $APP_PORT 已被占用"
            _use_anyway=$(read_input "是否继续使用此端口? (y/n)" "n")
            case "$_use_anyway" in
                [Yy]) break ;;
                *) continue ;;
            esac
        else
            break
        fi
    done
    
    # 镜像版本
    IMAGE_VERSION=$(read_input "镜像版本" "$DEFAULT_VERSION")
    
    echo ""
    print_info "以下为可选配置（直接回车使用默认值，部署后可在 .env 中修改）"
    echo ""
    
    # 管理员密码
    ADMIN_PASSWORD=$(read_input "管理员密码" "admin123" "true")
    
    # 确认配置
    echo ""
    print_step "配置确认"
    echo ""
    printf "   %b安装目录:%b       %s\n" "${BOLD}" "${NC}" "$INSTALL_DIR"
    printf "   %b应用端口:%b       %s\n" "${BOLD}" "${NC}" "$APP_PORT"
    printf "   %b镜像版本:%b       %s:%s\n" "${BOLD}" "${NC}" "$DOCKER_IMAGE" "$IMAGE_VERSION"
    printf "   %b管理员密码:%b     已设置\n" "${BOLD}" "${NC}"
    echo ""
    
    _confirm=$(read_input "确认以上配置并开始部署? (y/n)" "y")
    case "$_confirm" in
        [Yy]|[Yy][Ee][Ss]) ;;
        *)
            print_warning "已取消部署"
            exit 0
            ;;
    esac
}

# ==================== 创建配置文件 ====================
create_config_files() {
    print_step "创建配置文件"
    
    # 创建安装目录
    mkdir -p "$INSTALL_DIR"
    cd "$INSTALL_DIR"
    print_success "创建目录: $INSTALL_DIR"
    
    # 创建 .env 文件
    cat > .env << EOF
# ============================================================
# Kerkerker 环境配置
# 生成时间: $(date '+%Y-%m-%d %H:%M:%S')
# ============================================================
# 修改配置后请执行: ./kerkerker.sh restart
# ============================================================

# ==================== Docker 镜像配置 ====================
DOCKER_USERNAME=unilei
IMAGE_VERSION=${IMAGE_VERSION}

# ==================== 应用配置 ====================
APP_PORT=${APP_PORT}
NODE_ENV=production

# ==================== 安全配置 ====================
# 管理员密码（访问 /login 页面时使用）
ADMIN_PASSWORD=${ADMIN_PASSWORD}

# ==================== 豆瓣 API 微服务配置 ====================
# 独立的豆瓣 API 服务地址 (kerkerker-douban-service)
# Docker 环境: http://host.docker.internal:8081
# 本地开发: http://localhost:8081
# 生产环境: https://your-douban-api.example.com
NEXT_PUBLIC_DOUBAN_API_URL=
EOF
    chmod 600 .env
    print_success "创建 .env 配置文件（权限: 600）"
    
    # 创建 docker-compose.yml
    cat > docker-compose.yml << 'EOF'
# Kerkerker Docker Compose 配置
# 自动生成，请勿手动修改结构

services:
  # Next.js 应用
  app:
    image: ${DOCKER_USERNAME:-unilei}/kerkerker:${IMAGE_VERSION:-latest}
    container_name: kerkerker-app
    ports:
      - "${APP_PORT:-3000}:3000"
    environment:
      - NODE_ENV=production
      - ADMIN_PASSWORD=${ADMIN_PASSWORD}
      - MONGODB_URI=mongodb://mongodb:27017/kerkerker
      - NEXT_PUBLIC_DOUBAN_API_URL=${NEXT_PUBLIC_DOUBAN_API_URL}
    depends_on:
      mongodb:
        condition: service_healthy
    networks:
      - kerkerker-network
    restart: unless-stopped

  # MongoDB 数据库
  mongodb:
    image: mongo:7
    container_name: kerkerker-mongodb
    environment:
      - MONGO_INITDB_DATABASE=kerkerker
    volumes:
      - mongodb-data:/data/db
      - mongodb-config:/data/configdb
    healthcheck:
      test: ["CMD", "mongosh", "--eval", "db.adminCommand('ping')"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - kerkerker-network
    restart: unless-stopped

networks:
  kerkerker-network:
    driver: bridge

volumes:
  mongodb-data:
  mongodb-config:
EOF
    print_success "创建 docker-compose.yml"
    
    # 创建管理脚本
    cat > kerkerker.sh << 'SCRIPT'
#!/bin/sh

# Kerkerker 管理脚本
# 版本: 1.1.0

cd "$(dirname "$0")"

# 检测 Docker Compose 命令
if command -v docker-compose > /dev/null 2>&1; then
    COMPOSE="docker-compose"
elif docker compose version > /dev/null 2>&1; then
    COMPOSE="docker compose"
else
    echo "❌ Docker Compose 未安装"
    exit 1
fi

# 加载环境变量
if [ -f .env ]; then
    set -a
    . ./.env
    set +a
fi

case "$1" in
    start)
        echo "🚀 启动服务..."
        $COMPOSE up -d
        ;;
    stop)
        echo "🛑 停止服务..."
        $COMPOSE down
        ;;
    restart)
        echo "🔄 重启服务（重新应用环境变量）..."
        $COMPOSE up -d --force-recreate app
        echo "✅ 重启完成"
        ;;
    logs)
        $COMPOSE logs -f "${2:-app}"
        ;;
    status)
        $COMPOSE ps
        ;;
    update)
        echo "📥 更新镜像..."
        $COMPOSE pull app
        echo "🔄 重启服务（使用新镜像并重新应用环境变量）..."
        $COMPOSE up -d --force-recreate app
        echo "🧹 清理旧镜像..."
        docker image prune -f
        echo "✅ 更新完成"
        ;;
    backup)
        echo "📦 备份数据..."
        BACKUP_DIR="./backups/$(date +%Y%m%d_%H%M%S)"
        mkdir -p "$BACKUP_DIR"
        if $COMPOSE exec -T mongodb mongodump --archive > "$BACKUP_DIR/mongodb.archive" 2>/dev/null; then
            cp .env "$BACKUP_DIR/.env"
            echo "✅ 备份完成: $BACKUP_DIR"
        else
            rm -rf "$BACKUP_DIR"
            echo "❌ 备份失败，请确保 MongoDB 服务正在运行"
            exit 1
        fi
        ;;
    restore)
        if [ -z "$2" ]; then
            echo "用法: ./kerkerker.sh restore <备份目录>"
            echo "示例: ./kerkerker.sh restore ./backups/20251226_120000"
            echo ""
            echo "可用备份:"
            ls -d ./backups/*/ 2>/dev/null || echo "   无备份"
            exit 1
        fi
        if [ ! -f "$2/mongodb.archive" ]; then
            echo "❌ 无效的备份目录: $2"
            exit 1
        fi
        echo "📦 恢复数据..."
        cat "$2/mongodb.archive" | $COMPOSE exec -T mongodb mongorestore --archive --drop
        echo "✅ 恢复完成"
        ;;
    uninstall)
        echo "⚠️  警告：此操作将删除所有容器、数据卷和配置文件！"
        echo ""
        printf "请输入 'yes' 确认卸载: "
        read _confirm
        if [ "$_confirm" = "yes" ]; then
            echo "🛑 停止并删除容器..."
            $COMPOSE down -v
            echo "🗑️  删除配置文件..."
            rm -f docker-compose.yml .env kerkerker.sh
            echo "✅ 卸载完成，数据卷已删除"
            echo "   注意: backups 目录已保留"
        else
            echo "❌ 已取消卸载"
        fi
        ;;
    env)
        echo "📋 当前环境变量:"
        echo "   ADMIN_PASSWORD: ${ADMIN_PASSWORD:-未设置}"
        echo "   APP_PORT: ${APP_PORT:-3000}"
        echo "   IMAGE_VERSION: ${IMAGE_VERSION:-latest}"
        echo "   NEXT_PUBLIC_DOUBAN_API_URL: ${NEXT_PUBLIC_DOUBAN_API_URL:-未设置}"
        ;;
    *)
        echo "Kerkerker 管理脚本 v1.1.0"
        echo ""
        echo "用法: ./kerkerker.sh <命令>"
        echo ""
        echo "命令:"
        echo "  start     启动服务"
        echo "  stop      停止服务"
        echo "  restart   重启服务（重新应用 .env 配置）"
        echo "  logs      查看日志 (可选参数: app/mongodb)"
        echo "  status    查看状态"
        echo "  update    更新到最新版本"
        echo "  backup    备份数据"
        echo "  restore   恢复数据 (参数: 备份目录)"
        echo "  uninstall 卸载服务"
        echo "  env       查看当前环境变量"
        ;;
esac
SCRIPT
    chmod +x kerkerker.sh
    print_success "创建管理脚本 kerkerker.sh"
}

# ==================== 部署服务 ====================
deploy_services() {
    print_step "部署服务"

    # 确保在安装目录中
    if [ -d "$INSTALL_DIR" ]; then
        cd "$INSTALL_DIR" || { print_error "无法进入安装目录"; exit 1; }
    fi

    # 拉取镜像
    print_info "拉取 Docker 镜像..."
    if $COMPOSE_CMD pull; then
        print_success "镜像拉取完成"
    else
        print_error "镜像拉取失败"
        exit 1
    fi

    # 启动服务
    print_info "启动服务..."
    if $COMPOSE_CMD up -d; then
        print_success "服务启动成功"
    else
        print_error "服务启动失败"
        exit 1
    fi

    # 等待服务就绪
    print_info "等待服务就绪..."
    sleep 15

    # 健康检查
    if command_exists curl; then
        print_info "执行健康检查..."
        _retries=10
        _success=0
        _i=1

        while [ "$_i" -le "$_retries" ]; do
            if curl -sf "http://localhost:${APP_PORT}/api/health" > /dev/null 2>&1; then
                _success=1
                break
            fi
            printf "."
            sleep 3
            _i=$((_i + 1))
        done
        echo ""

        if [ "$_success" = "1" ]; then
            print_success "健康检查通过"
        else
            print_warning "健康检查超时，服务可能仍在启动中"
        fi
    fi
}

# ==================== 显示完成信息 ====================
show_completion() {
    echo ""
    print_color "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}\n"
    print_color "${GREEN}║                                                           ║${NC}\n"
    print_color "${GREEN}║   ${BOLD}✅ 部署完成!${NC}${GREEN}                                          ║${NC}\n"
    print_color "${GREEN}║                                                           ║${NC}\n"
    print_color "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}\n"
    echo ""
    printf "%b📍 安装目录:%b %s\n" "${BOLD}" "${NC}" "$INSTALL_DIR"
    echo ""
    printf "%b🌐 访问地址:%b\n" "${BOLD}" "${NC}"
    echo "   应用首页:   http://localhost:${APP_PORT}"
    echo "   后台管理:   http://localhost:${APP_PORT}/login"
    echo ""
    printf "%b📝 常用命令:%b\n" "${BOLD}" "${NC}"
    echo "   cd $INSTALL_DIR"
    echo "   ./kerkerker.sh start    # 启动服务"
    echo "   ./kerkerker.sh stop     # 停止服务"
    echo "   ./kerkerker.sh logs     # 查看日志"
    echo "   ./kerkerker.sh update   # 更新版本"
    echo "   ./kerkerker.sh status   # 查看状态"
    echo "   ./kerkerker.sh backup   # 备份数据"
    echo ""
    printf "%b⚙️  修改配置:%b\n" "${BOLD}" "${NC}"
    printf "   配置文件位置: %b%s/.env%b\n" "${CYAN}" "$INSTALL_DIR" "${NC}"
    echo ""
    echo "   可修改的配置项:"
    echo "   - ADMIN_PASSWORD              管理员密码"
    echo "   - NEXT_PUBLIC_DOUBAN_API_URL  豆瓣 API 微服务地址"
    echo "   - APP_PORT                    应用端口"
    echo ""
    printf "   修改后执行: %b./kerkerker.sh restart%b\n" "${CYAN}" "${NC}"
    echo ""
    
    # 显示服务状态
    printf "%b📊 当前状态:%b\n" "${BOLD}" "${NC}"
    cd "$INSTALL_DIR"
    $COMPOSE_CMD ps
    echo ""
    
    # 显示教程链接
    printf "%b📖 更多教程:%b\n" "${BOLD}" "${NC}"
    echo "   项目文档: https://github.com/unilei/kerkerker"
    echo ""
}

# ==================== 更新管理脚本 ====================
update_management_script() {
    print_step "更新管理脚本"
    cd "$INSTALL_DIR"
    
    # 重新生成 kerkerker.sh（保留配置）
    cat > kerkerker.sh << 'SCRIPT'
#!/bin/sh

# Kerkerker 管理脚本
# 版本: 1.1.0

cd "$(dirname "$0")"

# 检测 Docker Compose 命令
if command -v docker-compose > /dev/null 2>&1; then
    COMPOSE="docker-compose"
elif docker compose version > /dev/null 2>&1; then
    COMPOSE="docker compose"
else
    echo "❌ Docker Compose 未安装"
    exit 1
fi

# 加载环境变量
if [ -f .env ]; then
    set -a
    . ./.env
    set +a
fi

case "$1" in
    start)
        echo "🚀 启动服务..."
        $COMPOSE up -d
        ;;
    stop)
        echo "🛑 停止服务..."
        $COMPOSE down
        ;;
    restart)
        echo "🔄 重启服务（重新应用环境变量）..."
        $COMPOSE up -d --force-recreate app
        echo "✅ 重启完成"
        ;;
    logs)
        $COMPOSE logs -f "${2:-app}"
        ;;
    status)
        $COMPOSE ps
        ;;
    update)
        echo "📥 更新镜像..."
        $COMPOSE pull app
        echo "🔄 重启服务（使用新镜像并重新应用环境变量）..."
        $COMPOSE up -d --force-recreate app
        echo "🧹 清理旧镜像..."
        docker image prune -f
        echo "✅ 更新完成"
        ;;
    backup)
        echo "📦 备份数据..."
        BACKUP_DIR="./backups/$(date +%Y%m%d_%H%M%S)"
        mkdir -p "$BACKUP_DIR"
        if $COMPOSE exec -T mongodb mongodump --archive > "$BACKUP_DIR/mongodb.archive" 2>/dev/null; then
            cp .env "$BACKUP_DIR/.env"
            echo "✅ 备份完成: $BACKUP_DIR"
        else
            rm -rf "$BACKUP_DIR"
            echo "❌ 备份失败，请确保 MongoDB 服务正在运行"
            exit 1
        fi
        ;;
    restore)
        if [ -z "$2" ]; then
            echo "用法: ./kerkerker.sh restore <备份目录>"
            echo "示例: ./kerkerker.sh restore ./backups/20251226_120000"
            echo ""
            echo "可用备份:"
            ls -d ./backups/*/ 2>/dev/null || echo "   无备份"
            exit 1
        fi
        if [ ! -f "$2/mongodb.archive" ]; then
            echo "❌ 无效的备份目录: $2"
            exit 1
        fi
        echo "📦 恢复数据..."
        cat "$2/mongodb.archive" | $COMPOSE exec -T mongodb mongorestore --archive --drop
        echo "✅ 恢复完成"
        ;;
    uninstall)
        echo "⚠️  警告：此操作将删除所有容器、数据卷和配置文件！"
        echo ""
        printf "请输入 'yes' 确认卸载: "
        read _confirm
        if [ "$_confirm" = "yes" ]; then
            echo "🛑 停止并删除容器..."
            $COMPOSE down -v
            echo "🗑️  删除配置文件..."
            rm -f docker-compose.yml .env kerkerker.sh
            echo "✅ 卸载完成，数据卷已删除"
            echo "   注意: backups 目录已保留"
        else
            echo "❌ 已取消卸载"
        fi
        ;;
    env)
        echo "📋 当前环境变量:"
        echo "   ADMIN_PASSWORD: ${ADMIN_PASSWORD:-未设置}"
        echo "   APP_PORT: ${APP_PORT:-3000}"
        echo "   IMAGE_VERSION: ${IMAGE_VERSION:-latest}"
        echo "   NEXT_PUBLIC_DOUBAN_API_URL: ${NEXT_PUBLIC_DOUBAN_API_URL:-未设置}"
        ;;
    *)
        echo "Kerkerker 管理脚本 v1.1.0"
        echo ""
        echo "用法: ./kerkerker.sh <命令>"
        echo ""
        echo "命令:"
        echo "  start     启动服务"
        echo "  stop      停止服务"
        echo "  restart   重启服务（重新应用 .env 配置）"
        echo "  logs      查看日志 (可选参数: app/mongodb)"
        echo "  status    查看状态"
        echo "  update    更新到最新版本"
        echo "  backup    备份数据"
        echo "  restore   恢复数据 (参数: 备份目录)"
        echo "  uninstall 卸载服务"
        echo "  env       查看当前环境变量"
        ;;
esac
SCRIPT
    chmod +x kerkerker.sh
    print_success "更新管理脚本 kerkerker.sh"
}

# ==================== 主程序 ====================
main() {
    print_banner
    check_dependencies
    check_existing_installation
    
    if [ "$UPGRADE_MODE" = "true" ]; then
        # 升级模式：保留配置，只更新镜像和脚本
        print_step "升级模式"
        update_management_script
        deploy_services
    else
        # 新安装模式
        interactive_config
        create_config_files
        deploy_services
    fi
    
    show_completion
}

# 运行主程序
main
