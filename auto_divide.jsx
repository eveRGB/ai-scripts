app.executeMenuCommand("outline");
app.executeMenuCommand('ungroup');
app.executeMenuCommand("noCompoundPath");

doc = app.activeDocument;
sels = doc.selection;
doc.layers.add();

function sub(a, b){
    return Array(a[0] - b[0], a[1] - b[1]);
}

function org_round(value) {
    return Math.round(value * 10) / 10;
}

function calc_distance(pos1, pos2){
    var a = Math.pow((pos1[0] - pos2[0]), 2);
    var b = Math.pow((pos1[1] - pos2[1]), 2);
    var distance = (Math.sqrt(a + b));
    return distance;
}

function calc_length(pos){
    var length = Math.sqrt(Math.pow(pos[0], 2) + Math.pow(pos[1], 2));
    return length;
}

function normalize(pos){
    var len = calc_length(pos);
    var norm = Array(pos[0]/len, pos[1]/len);
    return norm;
}

function calc_dir(a, b){
    return normalize(sub(b, a));
}

function dot(a, b){
    return a[0]*b[0] + a[1]*b[1];
}

function has_left_handle(point){
    // ハンドル位置とアンカー位置が異なればハンドルを持つ
    var EPS = 0.0001;
    var anchor = point.anchor;
    var left = point.leftDirection;
    return Math.abs(anchor[0] - left[0]) > EPS || Math.abs(anchor[1] - left[1]) > EPS;
}

function has_right_handle(point){
    // ハンドル位置とアンカー位置が異なればハンドルを持つ
    var EPS = 0.0001;
    var anchor = point.anchor;
    var right = point.rightDirection;
    return Math.abs(anchor[0] - right[0]) > EPS || Math.abs(anchor[1] - right[1]) > EPS;
}

function calc_cost(sel_id, i, cur_sel_id, j){

    base_points = sels[sel_id].pathPoints;
    base_point = base_points[i].anchor;

    target_point = sels[cur_sel_id].pathPoints[j].anchor;

    var cost = 0;

    // 道なりに進まない場合
    if(sel_id != cur_sel_id || j - i != 1){
        cost += 0.5;
    }

    // 距離コスト
    // 何かしらで正規化が必要 -> 道なりに進む場合を基準値にする
    // 隣接する辺でより短い方を採用
    var orig_dist1 = calc_distance(base_point, base_points[i+1].anchor);
    var orig_dist2 = calc_distance(base_point, base_points[i-1].anchor);
    var orig_dist = Math.min(orig_dist1, orig_dist2);

    var dist = calc_distance(base_point, target_point);
    cost += 3.0 * (dist/orig_dist);
    
    // より近い方の進行方向からなす角の内積
    // TODO: さらにこの時の微分値を、ハンドルを考慮した正確な方向にする
    var dir_from_prev = calc_dir(base_points[i-1].anchor, base_point);    // from prev
    if(has_left_handle(base_points[i])){
        var left_pos = base_points[i].leftDirection;
        dir_from_prev = calc_dir(left_pos, base_point);
    }
    var dir_from_next = calc_dir(base_points[i+1].anchor, base_point);    // from next
    if(has_right_handle(base_points[i])){
        var right_pos = base_points[i].rightDirection;
        dir_from_next = calc_dir(right_pos, base_point);
    }

    var new_dir = calc_dir(base_point, target_point);
    var dir_cost = 3.0 * (1 - Math.max(dot(dir_from_prev, new_dir), dot(dir_from_next, new_dir)));

    cost += dir_cost;

    // 斜めペナルティ
    var x_axis = Array(1.0, 0.0);
    var theta_deg = Math.acos(dot(new_dir, x_axis)) * ( 180 / Math.PI );
    cost += 0.2 * (theta_deg % 90) / 90;

    // セレクション跨ぎペナルティ
    // if(sel_id != cur_sel_id){
    //     cost += 1.0;
    // }

    return cost;
}

function cross(a, b){
    return a[0] * b[1] - a[1] * b[0];
}

function intersect(edge, line){
    var EPS = 0.01;
    var a1 = edge[0];
    var a2 = edge[1];
    var b1 = line[0];
    var b2 = line[1];

    var tmp1 = cross(sub(a2,a1), sub(b1,a1)) * cross(sub(a2,a1), sub(b2,a1)) < -EPS;
    var tmp2 = cross(sub(b2,b1), sub(a1,b1)) * cross(sub(b2,b1), sub(a2,b1)) < -EPS;
    return tmp1 && tmp2;
}

function intersect_any(all_edges, line){
    if(line == undefined){
        alert("line is undefined");
    }
    for(var i = 0; i < all_edges.length; i++){
        if(intersect(all_edges[i], line)){
            return true;
        }
    }
    return false;
}

function calc_center(line){
    var pos1 = line[0];
    var pos2 = line[1];
    var center = Array((pos1[0] + pos2[0])/2, (pos1[1] + pos2[1])/2);
    return center;
}

function is_in_text(all_edges, line){
    var center = calc_center(line);
    var right_point = Array(1000000.0, center[1] + 1000000.0);
    var scanline = Array(center, right_point);

    if(scanline == undefined){
        alert("scanline is undefined");
    }

    var intersect_cnt = 0;

    for(var i = 0; i < all_edges.length; i++){
        if(intersect(all_edges[i], scanline)){
            intersect_cnt++;
        }
    }

    // 奇数回なら内部 偶数回なら外部
    return intersect_cnt%2 == 1;
}

function is_already_exists(indices_buffer, sel_id, i, min_sel_id, min_pt_id){
    for (var buf_id = 0; buf_id < indices_buffer.length; buf_id++){
        // 逆順で既に入っている
        if(indices_buffer[buf_id][0] == min_sel_id
        && indices_buffer[buf_id][1] == min_pt_id
        && indices_buffer[buf_id][2] == sel_id
        && indices_buffer[buf_id][3] == i ){
            return true;
        }
    }
    return false;
}

function add_line(pos1, pos2){
    var line = doc.pathItems.add();

    // stroke
    line.stroked = true;
    var newRGBColor = new RGBColor();
    newRGBColor.red = 255;
    newRGBColor.green = 0;
    newRGBColor.blue = 0;
    line.strokeColor = newRGBColor;

    line.setEntirePath(Array(pos1, pos2));
}

//-----------------------main---------------------------

// calc all edges
var all_edges = []
for(var sel_id = 0; sel_id < sels.length; sel_id++){
    points = sels[sel_id].pathPoints;
    for (var i = 0; i < points.length; i++){
        var edge;
        if(i == points.length-1){
            edge = Array(points[i].anchor, points[0].anchor);
        }else{
            edge = Array(points[i].anchor, points[i+1].anchor);
        }
        all_edges.push(edge);
    }
}
if(all_edges.length > 300){
    alert("The process takes a long time because there are so many points!");
}
// alert("edges cnt: " + String(all_edges.length));

var indices_buffer = []

// selection loop
for(var sel_id = 0; sel_id < sels.length; sel_id++){
    points = sels[sel_id].pathPoints;

    // pathItemじゃない場合はpointsがundefined
    if(points == undefined){
        continue;
    }

    // point loop
    for (var i = 0; i < points.length; i++) {
        // // alert(points[i].anchor);

        // 最初と最後のポイントは無視
        if(i == 0 || i == points.length-1){
            continue;
        }

        // 全セレクションに対して探索
        var min_cost = 100000000;
        var min_sel_id = [-1, -1];
        var min_pt_id = [-1, -1];
        for(var cur_sel_id = 0; cur_sel_id < sels.length; cur_sel_id++){
            cur_points = sels[cur_sel_id].pathPoints;
            for(var j = 0; j < cur_points.length; j++){
                if(cur_sel_id == sel_id && j == i){
                    continue;
                }

                var cost = calc_cost(sel_id, i, cur_sel_id, j);

                if(cost < min_cost){
                    var n = 1.3;
                    // 最小コストのn倍未満であれば2番目にいれていい
                    if(min_cost < cost*n){
                        // 0->iにずらす(2番目に小さい)
                        min_sel_id[1] = min_sel_id[0];
                        min_pt_id[1] = min_pt_id[0];
                    }
                    // n倍以上の差があれば捨てる
                    else{
                        min_sel_id[1] = -1;
                        min_pt_id[1] = -1;
                    }

                    min_cost = cost;

                    // // 1番小さい
                    min_sel_id[0] = cur_sel_id;
                    min_pt_id[0] = j;
                }
            }
        }

        // 最小コスト2番目まで追加する
        for(var line_id=0; line_id<2; line_id++){
            // 道なりでなければ線をひく
            var is_next = min_sel_id[line_id] == sel_id && min_pt_id[line_id] == i+1;
            var is_prev = min_sel_id[line_id] == sel_id && min_pt_id[line_id] == i-1;
            if(!is_next && !is_prev){
    
                if(min_sel_id[line_id] == -1){
                    continue;
                }
                if(min_pt_id[line_id] == -1){
                    continue;
                }
    
                // エッジをまたいでたら引かない
                var min_point = sels[min_sel_id[line_id]].pathPoints[min_pt_id[line_id]].anchor;
                var line_vec = Array(points[i].anchor, min_point);
                if(intersect_any(all_edges, line_vec)){
                    continue;
                }
    
                // テキストの外部なら引かない
                if(!is_in_text(all_edges, line_vec)){
                    continue;
                }
    
                // インデックスバッファに既にある場合は引かない
                // if(is_already_exists(indices_buffer, sel_id, i, min_sel_id[line_id], min_pt_id[line_id])){
                //     alert("is_already_exists");
                //     continue;
                // }

                add_line(points[i].anchor, min_point);
    
                // インデックスバッファに保存
                indices_buffer.push([sel_id, i, min_sel_id[line_id], min_pt_id[line_id]]);
            }
        }
    }
}

app.executeMenuCommand('group');
app.executeMenuCommand("Live Pathfinder Exclude");
app.executeMenuCommand('expandStyle');
app.executeMenuCommand('ungroup');

// alert("end");